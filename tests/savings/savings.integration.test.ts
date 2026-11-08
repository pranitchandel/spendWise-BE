import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { accountService } from '../../src/modules/accounts/account.service.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { SavingsGoalModel } from '../../src/modules/savings/savings.model.js';
import { createSavingsGoal, deleteSavingsGoal, listSavingsGoals, recordSavingsMovement, updateSavingsGoal } from '../../src/modules/savings/savings.service.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let sourceAccountId: string;
let savingsAccountId: string;
let secondSavingsAccountId: string;
let transferCategoryId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([
    AccountModel.init(),
    CategoryModel.init(),
    SavingsGoalModel.init(),
    TransactionModel.init(),
  ]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    SavingsGoalModel.deleteMany({}),
    TransactionModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();
  const [source, savings, secondSavings] = await AccountModel.create([
    { userId, name: 'Main', type: 'SAVINGS', openingBalancePaise: 500_000, openingBalanceDate: new Date('2026-01-01T00:00:00.000Z') },
    { userId, name: 'Emergency fund', type: 'SAVINGS', openingBalancePaise: 100_000, openingBalanceDate: new Date('2026-01-01T00:00:00.000Z') },
    { userId, name: 'Home deposit', type: 'SAVINGS', openingBalancePaise: 0, openingBalanceDate: new Date('2026-01-01T00:00:00.000Z') },
  ]);
  const transferCategory = await CategoryModel.create({ userId, name: 'Transfers', type: 'TRANSFER' });
  sourceAccountId = source._id.toString();
  savingsAccountId = savings._id.toString();
  secondSavingsAccountId = secondSavings._id.toString();
  transferCategoryId = transferCategory._id.toString();
});

const allocation = (name: string, monthlyContribution = 500) => ({
  name,
  optionType: 'BANK_SAVINGS' as const,
  expectedAnnualReturnRate: 6,
  compoundingFrequency: 'MONTHLY' as const,
  monthlyContribution,
});

describe('savings goals', () => {
  it('projects from goal-linked transfers and keeps estimates out of account balances', async () => {
    const user = userId.toString();
    const goal = await createSavingsGoal(user, {
      name: 'Safety net',
      targetAmount: 50_000,
      targetDate: '2027-01-01',
      allocations: [allocation('Emergency fund', 1_000), allocation('Home deposit', 2_000)],
    });
    expect(goal).toMatchObject({ status: 'ACTIVE', currentBalance: 0, monthlyContribution: 3_000 });
    expect(goal.projectedBalance).toBeGreaterThan(goal.currentBalance);
    expect(await accountService.getBalance(user, savingsAccountId)).toMatchObject({ balance: 1_000 });
    expect(await accountService.getBalance(user, sourceAccountId)).toMatchObject({ balance: 5_000 });

    await expect(recordSavingsMovement(user, goal.id, goal.allocations[0].id, {
      direction: 'DEPOSIT',
      amount: 6_000,
      transactionDate: '2026-11-03',
      counterpartAccountId: sourceAccountId,
      paymentMode: 'BANK_TRANSFER',
      categoryId: transferCategoryId,
    }, 'saving-deposit-overdraft')).rejects.toMatchObject({ statusCode: 400 });

    const deposited = await recordSavingsMovement(user, goal.id, goal.allocations[0].id, {
      direction: 'DEPOSIT',
      amount: 2_500,
      transactionDate: '2026-11-04',
      counterpartAccountId: sourceAccountId,
      paymentMode: 'BANK_TRANSFER',
      categoryId: transferCategoryId,
      note: 'Monthly savings',
    }, 'saving-deposit-1');
    expect(deposited.currentBalance).toBe(2_500);
    expect(await accountService.getBalance(user, sourceAccountId)).toMatchObject({ balance: 2_500 });
    expect(await accountService.getBalance(user, savingsAccountId)).toMatchObject({ balance: 1_000 });
    expect(await TransactionModel.countDocuments({ userId, type: 'EXPENSE' })).toBe(0);
    const savedTransfer = await TransactionModel.findOne({ userId, savingsGoalId: goal.id, isDeleted: false });
    expect(savedTransfer).toMatchObject({ type: 'TRANSFER', savingsAllocationId: goal.allocations[0].id, savingsMovementDirection: 'DEPOSIT', toAccountId: null });
    await expect(recordSavingsMovement(user, goal.id, goal.allocations[0].id, {
      direction: 'WITHDRAWAL', amount: 3_000, transactionDate: '2026-11-05', counterpartAccountId: sourceAccountId,
      paymentMode: 'CASH', categoryId: transferCategoryId,
    })).rejects.toMatchObject({ statusCode: 400 });

    const withdrawn = await recordSavingsMovement(user, goal.id, goal.allocations[0].id, {
      direction: 'WITHDRAWAL',
      amount: 500,
      transactionDate: '2026-11-05',
      counterpartAccountId: sourceAccountId,
      paymentMode: 'UPI',
      categoryId: transferCategoryId,
    }, 'saving-withdrawal-1');
    expect(withdrawn.currentBalance).toBe(2_000);
    expect(await accountService.getBalance(user, sourceAccountId)).toMatchObject({ balance: 3_000 });
    const savedWithdrawal = await TransactionModel.findOne({ userId, savingsGoalId: goal.id, savingsMovementDirection: 'WITHDRAWAL' });
    expect(savedWithdrawal?.type).toBe('TRANSFER');
    expect(savedWithdrawal?.accountId.toString()).toBe(sourceAccountId);
    expect(savedWithdrawal?.toAccountId).toBeNull();
    expect(withdrawn.allocations[0].movements.map((movement) => movement.direction)).toEqual(['WITHDRAWAL', 'DEPOSIT']);
  });

  it('allows goals to reuse accounts and protects linked history', async () => {
    const user = userId.toString();
    const goal = await createSavingsGoal(user, {
      name: 'Emergency',
      targetAmount: 20_000,
      targetDate: '2027-01-01',
      allocations: [allocation('Emergency account')],
    });
    const sharedAccountGoal = await createSavingsGoal(user, {
      name: 'Duplicate account goal',
      targetAmount: 10_000,
      targetDate: '2027-01-01',
      allocations: [allocation('Same account')],
    });
    expect(sharedAccountGoal.currentBalance).toBe(0);

    const paused = await updateSavingsGoal(user, goal.id, { status: 'PAUSED' });
    expect(paused.status).toBe('PAUSED');
    const anotherSharedAccountGoal = await createSavingsGoal(user, {
      name: 'Shared account while paused',
      targetAmount: 10_000,
      targetDate: '2027-01-01',
      allocations: [allocation('Same paused account')],
    });
    expect(anotherSharedAccountGoal.currentBalance).toBe(0);

    await updateSavingsGoal(user, goal.id, { status: 'ACTIVE' });
    await recordSavingsMovement(user, goal.id, goal.allocations[0].id, {
      direction: 'DEPOSIT',
      amount: 1_000,
      transactionDate: '2026-11-04',
      counterpartAccountId: sourceAccountId,
      paymentMode: 'CASH',
      categoryId: transferCategoryId,
    }, 'saving-history-1');
    const sharedAccountMovement = await recordSavingsMovement(user, sharedAccountGoal.id, sharedAccountGoal.allocations[0].id, {
      direction: 'DEPOSIT',
      amount: 500,
      transactionDate: '2026-11-04',
      counterpartAccountId: sourceAccountId,
      paymentMode: 'CASH',
      categoryId: transferCategoryId,
    }, 'saving-history-2');
    expect(sharedAccountMovement.currentBalance).toBe(500);
    expect((await listSavingsGoals(user)).find((candidate) => candidate.id === goal.id)?.currentBalance).toBe(1_000);
    await expect(deleteSavingsGoal(user, goal.id)).rejects.toMatchObject({ statusCode: 409 });

    const completed = await updateSavingsGoal(user, goal.id, { status: 'COMPLETED' });
    expect(completed.projectedBalance).toBe(completed.currentBalance);
    await expect(recordSavingsMovement(user, goal.id, goal.allocations[0].id, {
      direction: 'DEPOSIT', amount: 100, transactionDate: '2026-11-06', counterpartAccountId: sourceAccountId,
      paymentMode: 'CASH', categoryId: transferCategoryId,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows deleting a goal with no transfer history and rejects withdrawals above actual balance', async () => {
    const user = userId.toString();
    const goal = await createSavingsGoal(user, {
      name: 'No movement yet',
      targetAmount: 5_000,
      targetDate: '2027-01-01',
      allocations: [allocation('Empty allocation')],
    });
    await expect(recordSavingsMovement(user, goal.id, goal.allocations[0].id, {
      direction: 'WITHDRAWAL', amount: 1, transactionDate: '2026-11-04', counterpartAccountId: sourceAccountId,
      paymentMode: 'CASH', categoryId: transferCategoryId,
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteSavingsGoal(user, goal.id)).resolves.toEqual({ id: goal.id });
    expect(await SavingsGoalModel.findById(goal.id)).toMatchObject({ isDeleted: true });
    expect(await listSavingsGoals(user)).toHaveLength(0);
  });

  it('soft-deletes removed allocations instead of erasing their embedded history', async () => {
    const user = userId.toString();
    const goal = await createSavingsGoal(user, {
      name: 'Two buckets',
      targetAmount: 10_000,
      targetDate: '2027-01-01',
      allocations: [allocation('Keep'), allocation('Remove')],
    });

    const updated = await updateSavingsGoal(user, goal.id, {
      allocations: [{
        id: goal.allocations[0].id,
        name: 'Keep',
        optionType: 'BANK_SAVINGS',
        expectedAnnualReturnRate: 6,
        compoundingFrequency: 'MONTHLY',
        monthlyContribution: 500,
      }],
    });
    const stored = await SavingsGoalModel.findById(goal.id);

    expect(updated.allocations).toHaveLength(1);
    expect(stored?.allocations).toHaveLength(2);
    expect(stored?.allocations.find((item) => item.name === 'Remove')?.isDeleted).toBe(true);
  });
});

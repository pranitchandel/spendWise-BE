import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { accountService } from '../../src/modules/accounts/account.service.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { PlannedIncomeModel } from '../../src/modules/planned-incomes/planned-income.model.js';
import { createPlannedIncome, deletePlannedIncome, listPlannedIncomes, recordPlannedIncome, updatePlannedIncome } from '../../src/modules/planned-incomes/planned-income.service.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let accountId: string;
let incomeCategoryId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([AccountModel.init(), CategoryModel.init(), PlannedIncomeModel.init(), TransactionModel.init()]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all([AccountModel.deleteMany({}), CategoryModel.deleteMany({}), PlannedIncomeModel.deleteMany({}), TransactionModel.deleteMany({})]);
  userId = new Types.ObjectId();
  const [account, category] = await Promise.all([
    AccountModel.create({ userId, name: 'Salary account', type: 'SAVINGS', openingBalancePaise: 100_000, openingBalanceDate: new Date('2026-01-01T00:00:00.000Z') }),
    CategoryModel.create({ userId, name: 'Salary', type: 'INCOME' }),
  ]);
  accountId = account._id.toString();
  incomeCategoryId = category._id.toString();
});

describe('planned income schedules', () => {
  it('records each scheduled occurrence once as actual income in its receiving account', async () => {
    const user = userId.toString();
    const plan = await createPlannedIncome(user, {
      name: 'Salary', amount: 80_000, accountId, startDate: '2026-11-30', frequency: 'MONTHLY', endDate: '2027-02-28',
    });
    expect(plan).toMatchObject({ name: 'Salary', amount: 80_000, frequency: 'MONTHLY', accountId });

    const recorded = await recordPlannedIncome(user, plan.id, {
      scheduledDate: '2026-12-30', actualDate: '2026-12-31', amount: 79_500,
      paymentMode: 'BANK_TRANSFER', categoryId: incomeCategoryId,
    }, 'salary-2026-12');
    expect(recorded.actuals).toMatchObject([{ scheduledDate: '2026-12-30', actualDate: '2026-12-31', amount: 79_500 }]);
    expect(await accountService.getBalance(user, accountId)).toMatchObject({ balance: 80_500 });
    const transaction = await TransactionModel.findOne({ userId, plannedIncomeId: plan.id, isDeleted: false });
    expect(transaction).toMatchObject({ type: 'INCOME', amountPaise: 7_950_000, plannedIncomeOccurrenceDate: expect.any(Date) });

    await expect(recordPlannedIncome(user, plan.id, {
      scheduledDate: '2026-12-30', actualDate: '2026-12-31', amount: 79_500,
      paymentMode: 'BANK_TRANSFER', categoryId: incomeCategoryId,
    })).rejects.toMatchObject({ statusCode: 409 });
    const listed = await listPlannedIncomes(user);
    expect(listed[0].actuals).toHaveLength(1);
  });

  it('rejects non-scheduled dates and preserves plans with actual ledger history', async () => {
    const user = userId.toString();
    const plan = await createPlannedIncome(user, {
      name: 'Monthly salary', amount: 50_000, accountId, startDate: '2026-11-30', frequency: 'MONTHLY',
    });
    await expect(recordPlannedIncome(user, plan.id, {
      scheduledDate: '2026-12-29', actualDate: '2026-12-29', amount: 50_000,
      paymentMode: 'BANK_TRANSFER', categoryId: incomeCategoryId,
    })).rejects.toMatchObject({ statusCode: 400 });

    await recordPlannedIncome(user, plan.id, {
      scheduledDate: '2026-12-30', actualDate: '2026-12-31', amount: 50_000,
      paymentMode: 'BANK_TRANSFER', categoryId: incomeCategoryId,
    }, 'salary-month-end');
    await expect(deletePlannedIncome(user, plan.id)).rejects.toMatchObject({ statusCode: 409 });
    await updatePlannedIncome(user, plan.id, { status: 'CANCELLED' });
    await expect(updatePlannedIncome(user, plan.id, { name: 'Changed' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('soft-deletes an income schedule that has no actual receipts', async () => {
    const user = userId.toString();
    const plan = await createPlannedIncome(user, {
      name: 'One-time bonus', amount: 10_000, accountId, startDate: '2026-12-15', frequency: 'ONCE',
    });

    await expect(deletePlannedIncome(user, plan.id)).resolves.toEqual({ id: plan.id });

    expect(await PlannedIncomeModel.findById(plan.id)).toMatchObject({ isDeleted: true });
    expect(await listPlannedIncomes(user)).toHaveLength(0);
  });
});
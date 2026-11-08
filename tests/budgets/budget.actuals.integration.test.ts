import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { MonthlyBudgetModel } from '../../src/modules/budgets/budget.model.js';
import { getBudget, createBudget, copyBudget, getMonthlySpendingByCategory, updateBudget } from '../../src/modules/budgets/budget.service.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';
import { createTransaction } from '../../src/modules/transactions/transaction.service.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let accountId: string;
let categoryId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([AccountModel.init(), CategoryModel.init(), MonthlyBudgetModel.init(), TransactionModel.init()]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    MonthlyBudgetModel.deleteMany({}),
    TransactionModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();
  const account = await AccountModel.create({
    userId,
    name: 'Cash',
    type: 'CASH',
    openingBalancePaise: 100_000,
    openingBalanceDate: new Date('2026-11-01T00:00:00.000Z'),
  });
  const category = await CategoryModel.create({ userId, name: 'Groceries', type: 'EXPENSE' });
  accountId = account._id.toString();
  categoryId = category._id.toString();
});

describe('monthly budget expense actuals', () => {
  it('copies a December budget into January of the next year', async () => {
    const user = userId.toString();
    await createBudget(user, { year: 2026, month: 12, items: [{ categoryId, amount: 5_000 }] });

    const copied = await copyBudget(user, { fromYear: 2026, fromMonth: 12, toYear: 2027, toMonth: 1 });

    expect(copied).toMatchObject({ year: 2027, month: 1 });
    expect(copied.items).toMatchObject([{ categoryId, budgetAmount: 5_000 }]);
    expect(await getBudget(user, 2026, 1)).toBeNull();
    expect(await getBudget(user, 2027, 1)).toMatchObject({ year: 2027, month: 1 });
  });

  it('soft-deletes removed budget categories while retaining the stored row', async () => {
    const user = userId.toString();
    const transport = await CategoryModel.create({ userId, name: 'Transport', type: 'EXPENSE' });
    const budget = await createBudget(user, {
      year: 2026,
      month: 11,
      items: [{ categoryId, amount: 5_000 }, { categoryId: transport._id.toString(), amount: 2_000 }],
    });

    const updated = await updateBudget(user, budget.id, { items: [{ categoryId, amount: 4_000 }] });
    const stored = await MonthlyBudgetModel.findById(budget.id);

    expect(updated.items).toHaveLength(1);
    expect(stored?.items).toHaveLength(2);
    expect(stored?.items.find((item) => item.categoryId.toString() === transport._id.toString())?.isDeleted).toBe(true);
  });

  it('counts same-month expenses against their allocated category only', async () => {
    await createBudget(userId.toString(), {
      year: 2026,
      month: 11,
      items: [{ categoryId, amount: 5_000 }],
    });
    await createTransaction(userId.toString(), {
      type: 'EXPENSE',
      amount: 1_250,
      transactionDate: '2026-11-03',
      categoryId,
      paymentMode: 'CASH',
      accountId,
    });

    const budget = await getBudget(userId.toString(), 2026, 11);

    expect(budget?.items).toHaveLength(1);
    expect(budget?.items[0]).toMatchObject({
      categoryId,
      budgetAmount: 5_000,
      actualSpent: 1_250,
      transactionCount: 1,
    });
    expect(budget?.summary.totalSpent).toBe(1_250);
  });

  it('excludes expenses assigned to another category from this category budget', async () => {
    await createBudget(userId.toString(), {
      year: 2026,
      month: 11,
      items: [{ categoryId, amount: 5_000 }],
    });
    const otherCategory = await CategoryModel.create({ userId, name: 'Travel', type: 'EXPENSE' });
    await createTransaction(userId.toString(), {
      type: 'EXPENSE',
      amount: 800,
      transactionDate: '2026-11-03',
      categoryId: otherCategory._id.toString(),
      paymentMode: 'CASH',
      accountId,
    });

    const budget = await getBudget(userId.toString(), 2026, 11);
    expect(budget?.items[0].actualSpent).toBe(0);
    expect(budget?.summary.totalSpent).toBe(0);
  });

  it('lists spending for categories without budgets and subtracts refunds', async () => {
    const diningCategory = await CategoryModel.create({ userId, name: 'Dining out', type: 'EXPENSE' });
    const expense = await createTransaction(userId.toString(), {
      type: 'EXPENSE',
      amount: 1_500,
      transactionDate: '2026-11-03',
      categoryId: diningCategory._id.toString(),
      paymentMode: 'CASH',
      accountId,
    });
    await createTransaction(userId.toString(), {
      type: 'REFUND',
      amount: 300,
      transactionDate: '2026-11-04',
      categoryId: diningCategory._id.toString(),
      paymentMode: 'CASH',
      accountId,
      linkedTransactionId: expense.id,
    });

    const spending = await getMonthlySpendingByCategory(userId.toString(), 2026, 11);

    expect(spending).toContainEqual(expect.objectContaining({
      categoryId: diningCategory._id.toString(),
      categoryName: 'Dining out',
      actualSpent: 1_200,
      transactionCount: 1,
    }));
  });
});
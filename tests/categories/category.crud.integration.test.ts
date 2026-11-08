import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MonthlyBudgetModel } from '../../src/modules/budgets/budget.model.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { categoryService } from '../../src/modules/categories/category.service.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([
    CategoryModel.init(),
    MonthlyBudgetModel.init(),
    TransactionModel.init(),
  ]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    CategoryModel.deleteMany({}),
    MonthlyBudgetModel.deleteMany({}),
    TransactionModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();
});

describe('category CRUD', () => {
  it('creates, updates, archives, and restores a category', async () => {
    const created = await categoryService.create(userId.toString(), {
      name: 'Coffee shops',
      type: 'EXPENSE',
      icon: 'coffee',
      color: '#A16207',
    });
    expect(created).toMatchObject({ name: 'Coffee shops', type: 'EXPENSE', isDefault: false });

    const updated = await categoryService.update(userId.toString(), String(created.id), {
      name: 'Cafe',
      color: '#B45309',
    });
    expect(updated).toMatchObject({ name: 'Cafe', color: '#B45309' });

    await categoryService.remove(userId.toString(), String(created.id));
    expect(await categoryService.list(userId.toString(), {})).toHaveLength(0);
    expect(await categoryService.list(userId.toString(), { includeArchived: true })).toHaveLength(1);

    const restored = await categoryService.update(userId.toString(), String(created.id), { isArchived: false });
    expect(restored).toMatchObject({ isArchived: false });
  });

  it('soft-deletes a category while preserving transaction and budget references', async () => {
    const category = await categoryService.create(userId.toString(), { name: 'Meals', type: 'EXPENSE' });
    await TransactionModel.create({
      userId,
      amountPaise: 100,
      transactionDate: new Date('2026-11-02T00:00:00.000Z'),
      type: 'EXPENSE',
      categoryId: category.id,
      paymentMode: 'CASH',
      accountId: new Types.ObjectId(),
    });
    await MonthlyBudgetModel.create({
      userId,
      year: 2026,
      month: 11,
      items: [{ categoryId: category.id, amountPaise: 10_000 }],
    });

    await categoryService.remove(userId.toString(), String(category.id));

    expect(await CategoryModel.findById(category.id)).toMatchObject({ isArchived: true });
    expect(await TransactionModel.countDocuments({ categoryId: category.id })).toBe(1);
    expect(await MonthlyBudgetModel.countDocuments({ 'items.categoryId': category.id })).toBe(1);
    expect(await categoryService.list(userId.toString(), {})).toHaveLength(0);
    expect(await categoryService.list(userId.toString(), { includeArchived: true })).toHaveLength(1);
  });
});

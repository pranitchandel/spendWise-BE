import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';
import {
  createTransaction,
  deleteTransaction,
} from '../../src/modules/transactions/transaction.service.js';
import type { CreateTransactionInput } from '../../src/modules/transactions/transaction.types.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let accountId: string;
let expenseCategoryId: string;
let otherCategoryId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([AccountModel.init(), CategoryModel.init(), TransactionModel.init()]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    TransactionModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();

  const account = await AccountModel.create({
    userId,
    name: 'Cash',
    type: 'CASH',
    openingBalancePaise: 0,
    openingBalanceDate: new Date('2026-11-03T00:00:00.000Z'),
  });
  accountId = account._id.toString();

  const categories = await CategoryModel.create([
    { userId, name: 'Groceries', type: 'EXPENSE' },
    { userId, name: 'Travel', type: 'EXPENSE' },
  ]);
  expenseCategoryId = categories[0]._id.toString();
  otherCategoryId = categories[1]._id.toString();
});

function transactionInput(
  overrides: Partial<CreateTransactionInput> = {},
): CreateTransactionInput {
  return {
    amount: 10,
    transactionDate: '2026-11-03',
    type: 'EXPENSE',
    categoryId: expenseCategoryId,
    paymentMode: 'CASH',
    accountId,
    ...overrides,
  };
}

describe('refund transaction integrity', () => {
  it('requires an original expense and its category', async () => {
    await expect(
      createTransaction(userId.toString(), transactionInput({ type: 'REFUND' })),
    ).rejects.toThrow('linkedTransactionId is required');

    const expense = await createTransaction(userId.toString(), transactionInput());
    await expect(
      createTransaction(
        userId.toString(),
        transactionInput({
          type: 'REFUND',
          amount: 1,
          categoryId: otherCategoryId,
          linkedTransactionId: expense.id,
        }),
      ),
    ).rejects.toThrow('Refund category must match');
  });

  it('prevents over-refunds and protects expenses until refunds are removed', async () => {
    const expense = await createTransaction(userId.toString(), transactionInput());
    const refund = await createTransaction(
      userId.toString(),
      transactionInput({ type: 'REFUND', amount: 6, linkedTransactionId: expense.id }),
    );

    await expect(
      createTransaction(
        userId.toString(),
        transactionInput({ type: 'REFUND', amount: 5, linkedTransactionId: expense.id }),
      ),
    ).rejects.toThrow('Refund exceeds the remaining refundable amount');
    await expect(deleteTransaction(userId.toString(), expense.id)).rejects.toThrow(
      'Cannot delete an expense with recorded refunds',
    );

    await deleteTransaction(userId.toString(), refund.id);
    await deleteTransaction(userId.toString(), expense.id);
  });
});
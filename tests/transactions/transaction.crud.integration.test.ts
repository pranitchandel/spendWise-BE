import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { accountService } from '../../src/modules/accounts/account.service.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { LendingRecordModel } from '../../src/modules/lending/lending.model.js';
import { RepaymentModel } from '../../src/modules/repayments/repayment.model.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../../src/modules/transactions/transaction.service.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let accountId: string;
let destinationAccountId: string;
let expenseCategoryId: string;
let lendingCategoryId: string;
let transferCategoryId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([
    AccountModel.init(),
    CategoryModel.init(),
    LendingRecordModel.init(),
    RepaymentModel.init(),
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
    LendingRecordModel.deleteMany({}),
    RepaymentModel.deleteMany({}),
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
  const destination = await AccountModel.create({
    userId,
    name: 'Savings',
    type: 'SAVINGS',
    openingBalancePaise: 0,
    openingBalanceDate: new Date('2026-11-01T00:00:00.000Z'),
  });
  accountId = account._id.toString();
  destinationAccountId = destination._id.toString();
  const categories = await CategoryModel.create([
    { userId, name: 'Groceries', type: 'EXPENSE' },
    { userId, name: 'Loans given', type: 'LENDING' },
    { userId, name: 'Transfers', type: 'TRANSFER' },
  ]);
  expenseCategoryId = categories[0]._id.toString();
  lendingCategoryId = categories[1]._id.toString();
  transferCategoryId = categories[2]._id.toString();
});

describe('transaction CRUD consistency', () => {
  it('updates ordinary expense transactions and updates a linked lending principal', async () => {
    const expense = await createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 10, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId, description: 'Groceries',
    });
    const editedExpense = await updateTransaction(userId.toString(), expense.id, {
      amount: 12, description: 'Weekly groceries',
    });
    expect(editedExpense.amount).toBe(12);
    expect(editedExpense.description).toBe('Weekly groceries');

    const lent = await createTransaction(userId.toString(), {
      type: 'LENDING', amount: 100, transactionDate: '2026-11-03', categoryId: lendingCategoryId,
      paymentMode: 'CASH', accountId, personName: 'Alex',
    });
    const editedLending = await updateTransaction(userId.toString(), lent.id, { amount: 120 });
    expect(editedLending.amount).toBe(120);
    const record = await LendingRecordModel.findById(lent.linkedRecordId);
    expect(record?.originalAmountPaise).toBe(12_000);
    expect(record?.outstandingPaise).toBe(12_000);
  });

  it('edits and deletes partial repayment transactions while restoring linked outstanding correctly', async () => {
    const lent = await createTransaction(userId.toString(), {
      type: 'LENDING', amount: 100, transactionDate: '2026-11-03', categoryId: lendingCategoryId,
      paymentMode: 'CASH', accountId, personName: 'Alex',
    });
    const repayment = await createTransaction(userId.toString(), {
      type: 'LENDING_REPAYMENT', amount: 30, transactionDate: '2026-11-04', categoryId: lendingCategoryId,
      paymentMode: 'CASH', accountId, linkedRecordId: lent.linkedRecordId,
    });

    await updateTransaction(userId.toString(), repayment.id, { amount: 50 });
    let record = await LendingRecordModel.findById(lent.linkedRecordId);
    expect(record?.outstandingPaise).toBe(5_000);
    expect(record?.totalRepaidPaise).toBe(5_000);

    await deleteTransaction(userId.toString(), repayment.id);
    record = await LendingRecordModel.findById(lent.linkedRecordId);
    expect(record?.outstandingPaise).toBe(10_000);
    expect(record?.totalRepaidPaise).toBe(0);
    expect(await RepaymentModel.countDocuments({ transactionId: repayment.id, isDeleted: false })).toBe(0);
  });

  it('deletes ordinary transactions and rejects deleting a parent with outstanding repayment history', async () => {
    const expense = await createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 5, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId,
    });
    expect(await deleteTransaction(userId.toString(), expense.id)).toEqual({ deleted: true });

    const lent = await createTransaction(userId.toString(), {
      type: 'LENDING', amount: 100, transactionDate: '2026-11-03', categoryId: lendingCategoryId,
      paymentMode: 'CASH', accountId, personName: 'Alex',
    });
    await createTransaction(userId.toString(), {
      type: 'LENDING_REPAYMENT', amount: 20, transactionDate: '2026-11-04', categoryId: lendingCategoryId,
      paymentMode: 'CASH', accountId, linkedRecordId: lent.linkedRecordId,
    });
    await expect(deleteTransaction(userId.toString(), lent.id)).rejects.toThrow('existing repayments');
  });

  it('updates refunds without exceeding their original expense and releases the hold on delete', async () => {
    const expense = await createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 100, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId,
    });
    const refund = await createTransaction(userId.toString(), {
      type: 'REFUND', amount: 20, transactionDate: '2026-11-05', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId, linkedTransactionId: expense.id,
    });

    await updateTransaction(userId.toString(), refund.id, { amount: 35 });
    const original = await TransactionModel.findById(expense.id);
    expect(original?.refundedPaise).toBe(3_500);
    await expect(updateTransaction(userId.toString(), refund.id, { amount: 101 })).rejects.toThrow('Refund exceeds');

    await deleteTransaction(userId.toString(), refund.id);
    const afterDelete = await TransactionModel.findById(expense.id);
    expect(afterDelete?.refundedPaise).toBe(0);
  });

  it('edits transfer amount and destination while account balances remain ledger-derived', async () => {
    const transfer = await createTransaction(userId.toString(), {
      type: 'TRANSFER', amount: 100, transactionDate: '2026-11-03', categoryId: transferCategoryId,
      paymentMode: 'BANK_TRANSFER', accountId, toAccountId: destinationAccountId,
    });

    await updateTransaction(userId.toString(), transfer.id, {
      amount: 150,
      toAccountId: accountId,
      accountId: destinationAccountId,
    });

    expect(await accountService.getBalancePaise(userId.toString(), accountId)).toBe(115_000);
    expect(await accountService.getBalancePaise(userId.toString(), destinationAccountId)).toBe(-15_000);
    expect((await TransactionModel.findById(transfer.id))?.toAccountId?.toString()).toBe(accountId);
  });
});

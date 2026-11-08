import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { ActivityLogModel } from '../../src/modules/activity-logs/activity-log.model.js';
import { listActivityLogs } from '../../src/modules/activity-logs/activity-log.service.js';
import { listActivityLogsSchema } from '../../src/modules/activity-logs/activity-log.types.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../../src/modules/transactions/transaction.service.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let accountId: string;
let destinationAccountId: string;
let expenseCategoryId: string;
let transferCategoryId: string;
let lendingCategoryId: string;

const query = (overrides: Record<string, unknown> = {}) => listActivityLogsSchema.parse(overrides);

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([AccountModel.init(), CategoryModel.init(), TransactionModel.init(), ActivityLogModel.init()]);
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
    ActivityLogModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();
  const [account, destination] = await AccountModel.create([
    { userId, name: 'Cash', type: 'CASH', openingBalancePaise: 100_000, openingBalanceDate: new Date('2026-11-01T00:00:00.000Z') },
    { userId, name: 'Savings', type: 'SAVINGS', openingBalancePaise: 0, openingBalanceDate: new Date('2026-11-01T00:00:00.000Z') },
  ]);
  accountId = account._id.toString();
  destinationAccountId = destination._id.toString();
  const categories = await CategoryModel.create([
    { userId, name: 'Groceries', type: 'EXPENSE' },
    { userId, name: 'Transfers', type: 'TRANSFER' },
    { userId, name: 'Loans given', type: 'LENDING' },
  ]);
  expenseCategoryId = categories[0]._id.toString();
  transferCategoryId = categories[1]._id.toString();
  lendingCategoryId = categories[2]._id.toString();
});

describe('transaction activity log', () => {
  it('records create, update and delete with balance effects and field changes', async () => {
    const expense = await createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 10, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId, description: 'Groceries',
    });
    await updateTransaction(userId.toString(), expense.id, { amount: 12, description: 'Weekly groceries' });
    await deleteTransaction(userId.toString(), expense.id);

    const { items, pagination } = await listActivityLogs(userId.toString(), query());
    expect(pagination.total).toBe(3);
    const [deleted, updated, created] = items;

    expect(created).toMatchObject({ action: 'CREATED', transactionId: expense.id, source: 'MANUAL', amount: 10 });
    expect(created.effects).toEqual([{ accountId, delta: -10 }]);

    expect(updated.action).toBe('UPDATED');
    expect(updated.effects).toEqual([{ accountId, delta: -2 }]);
    expect(updated.changes.map((change) => change.field).sort()).toEqual(['amount', 'description']);
    expect(updated.changes.find((change) => change.field === 'amount')).toMatchObject({ from: 10, to: 12 });

    expect(deleted.action).toBe('DELETED');
    expect(deleted.effects).toEqual([{ accountId, delta: 12 }]);
  });

  it('logs both sides of a transfer and supports account and action filters', async () => {
    await createTransaction(userId.toString(), {
      type: 'TRANSFER', amount: 25, transactionDate: '2026-11-03', categoryId: transferCategoryId,
      paymentMode: 'CASH', accountId, toAccountId: destinationAccountId,
    });
    await createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 5, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId,
    });

    const byDestination = await listActivityLogs(userId.toString(), query({ accountId: destinationAccountId }));
    expect(byDestination.items).toHaveLength(1);
    expect(byDestination.items[0].effects).toEqual([
      { accountId, delta: -25 },
      { accountId: destinationAccountId, delta: 25 },
    ]);

    const none = await listActivityLogs(userId.toString(), query({ action: 'DELETED' }));
    expect(none.items).toHaveLength(0);
  });

  it('captures account balances before and after, and the state of linked records', async () => {
    const expense = await createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 40, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId,
    });
    await createTransaction(userId.toString(), {
      type: 'REFUND', amount: 15, transactionDate: '2026-11-04', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId, linkedTransactionId: expense.id,
    });
    const lent = await createTransaction(userId.toString(), {
      type: 'LENDING', amount: 100, transactionDate: '2026-11-05', categoryId: lendingCategoryId,
      paymentMode: 'CASH', accountId, personName: 'Alex',
    });
    await createTransaction(userId.toString(), {
      type: 'LENDING_REPAYMENT', amount: 30, transactionDate: '2026-11-06', categoryId: lendingCategoryId,
      paymentMode: 'CASH', accountId, linkedRecordId: lent.linkedRecordId,
    });

    const { items } = await listActivityLogs(userId.toString(), query());
    const [repayment, , refund, expenseLog] = items as Array<{ context: any }>;

    // Opening balance is 1000 rupees.
    expect(expenseLog.context.accounts[0]).toMatchObject({ balanceBefore: 1000, balanceAfter: 960 });
    expect(refund.context.accounts[0]).toMatchObject({ balanceBefore: 960, balanceAfter: 975 });
    expect(refund.context.originalExpense).toMatchObject({ amount: 40, refunded: 15, remainingRefundable: 25 });
    expect(repayment.context.accounts[0]).toMatchObject({ balanceBefore: 875, balanceAfter: 905 });
    expect(repayment.context.loan).toMatchObject({
      kind: 'LENDING', person: 'Alex', status: 'PARTIALLY_REPAID', original: 100, outstanding: 70, repaid: 30,
    });
  });

  it('does not log a rejected change and never exposes another user\'s entries', async () => {
    await expect(createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 5, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId: new Types.ObjectId().toString(),
    })).rejects.toThrow();
    expect(await ActivityLogModel.countDocuments({})).toBe(0);

    await createTransaction(userId.toString(), {
      type: 'EXPENSE', amount: 5, transactionDate: '2026-11-03', categoryId: expenseCategoryId,
      paymentMode: 'CASH', accountId,
    });
    const other = await listActivityLogs(new Types.ObjectId().toString(), query());
    expect(other.items).toHaveLength(0);
  });
});

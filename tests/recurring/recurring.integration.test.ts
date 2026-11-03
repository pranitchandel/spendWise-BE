import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { RecurringOccurrenceModel, RecurringRuleModel } from '../../src/modules/recurring/recurring.model.js';
import {
  createRecurring,
  deleteRecurring,
  generateOccurrences,
  listRecurring,
  updateRecurring,
  updateOccurrence,
} from '../../src/modules/recurring/recurring.service.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';
import { deleteTransaction } from '../../src/modules/transactions/transaction.service.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let accountId: string;
let categoryId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([
    AccountModel.init(),
    CategoryModel.init(),
    RecurringRuleModel.init(),
    RecurringOccurrenceModel.init(),
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
    RecurringRuleModel.deleteMany({}),
    RecurringOccurrenceModel.deleteMany({}),
    TransactionModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();
  const account = await AccountModel.create({
    userId,
    name: 'Main cash',
    type: 'CASH',
    openingBalancePaise: 0,
    openingBalanceDate: new Date('2026-10-01T00:00:00.000Z'),
  });
  const category = await CategoryModel.create({ userId, name: 'Subscriptions', type: 'EXPENSE' });
  accountId = account._id.toString();
  categoryId = category._id.toString();
});

async function createMonthlyRule() {
  return createRecurring(userId.toString(), {
    name: 'Internet bill',
    type: 'EXPENSE',
    amount: 800,
    frequency: 'MONTHLY',
    categoryId,
    accountId,
    paymentMode: 'UPI',
    startDate: '2026-11-01',
  });
}

describe('recurring transaction occurrences', () => {
  it('updates recurring schedule details', async () => {
    const rule = await createMonthlyRule();

    const updated = await updateRecurring(userId.toString(), rule.id, {
      name: 'Updated internet bill',
      amount: 950,
      frequency: 'QUARTERLY',
      notes: 'Review at renewal',
      startDate: '2027-02-15',
    });

    expect(updated).toMatchObject({
      name: 'Updated internet bill',
      amount: 950,
      frequency: 'QUARTERLY',
      notes: 'Review at renewal',
      startDate: '2027-02-15',
      nextDueDate: '2027-02-15',
      isActive: true,
    });
  });

  it('cancels a schedule without deleting generated occurrence history', async () => {
    const rule = await createMonthlyRule();
    await generateOccurrences(userId.toString(), '2026-11-30');

    const deleted = await deleteRecurring(userId.toString(), rule.id);

    expect(deleted.isActive).toBe(false);
    expect(deleted.occurrences).toHaveLength(1);
    expect(deleted.occurrences[0].status).toBe('PENDING');
    expect(await generateOccurrences(userId.toString(), '2027-01-31')).toEqual({ generated: 0 });
  });

  it('generates due occurrences once and leaves them pending', async () => {
    await createMonthlyRule();

    expect(await generateOccurrences(userId.toString(), '2026-11-30')).toEqual({ generated: 1 });
    expect(await generateOccurrences(userId.toString(), '2026-11-30')).toEqual({ generated: 0 });

    const [rule] = await listRecurring(userId.toString());
    expect(rule.occurrences).toHaveLength(1);
    expect(rule.occurrences[0].status).toBe('PENDING');
    expect(await TransactionModel.countDocuments({ userId })).toBe(0);
  });

  it('creates a ledger transaction only after an occurrence is explicitly marked paid', async () => {
    const rule = await createMonthlyRule();
    await generateOccurrences(userId.toString(), '2026-11-30');
    const [pendingRule] = await listRecurring(userId.toString());
    const occurrence = pendingRule.occurrences[0];

    const updated = await updateOccurrence(userId.toString(), rule.id, occurrence.id, {
      action: 'PAID',
      accountId,
      paymentMode: 'UPI',
    });

    expect(updated.occurrences[0].status).toBe('PAID');
    expect(updated.occurrences[0].paidTransactionId).toBeTruthy();
    expect(await TransactionModel.countDocuments({ userId, type: 'EXPENSE' })).toBe(1);
  });

  it('returns a recurring occurrence to pending when its transaction is deleted', async () => {
    const rule = await createMonthlyRule();
    await generateOccurrences(userId.toString(), '2026-11-30');
    const [pendingRule] = await listRecurring(userId.toString());
    const occurrence = pendingRule.occurrences[0];
    const paidRule = await updateOccurrence(userId.toString(), rule.id, occurrence.id, {
      action: 'PAID',
      accountId,
      paymentMode: 'UPI',
    });
    const transactionId = paidRule.occurrences[0].paidTransactionId!;

    await deleteTransaction(userId.toString(), transactionId);

    const [updatedRule] = await listRecurring(userId.toString());
    expect(updatedRule.occurrences[0]).toMatchObject({ status: 'PENDING', paidTransactionId: null });
    expect(await TransactionModel.findById(transactionId)).toBeNull();
  });

  it('keeps month-end schedules anchored to their original day', async () => {
    await createRecurring(userId.toString(), {
      name: 'Monthly payment',
      type: 'EXPENSE',
      amount: 800,
      frequency: 'MONTHLY',
      categoryId,
      accountId,
      paymentMode: 'UPI',
      startDate: '2027-01-31',
    });

    await generateOccurrences(userId.toString(), '2027-03-31');
    const [rule] = await listRecurring(userId.toString());
    expect(rule.occurrences.map((occurrence) => occurrence.dueDate)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });
});
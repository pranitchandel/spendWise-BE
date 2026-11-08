import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { getMonthlySpendingByCategory } from '../../src/modules/budgets/budget.service.js';
import { PlannedExpenseModel } from '../../src/modules/planned-expenses/planned-expense.model.js';
import {
  createPlannedExpense,
  deletePlannedExpense,
  listPlannedExpenses,
  recordCampaignSpend,
  updatePlannedExpense,
} from '../../src/modules/planned-expenses/planned-expense.service.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from '../../src/modules/transactions/transaction.service.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let travelCategoryId: string;
let giftCategoryId: string;
let accountId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([
    AccountModel.init(),
    CategoryModel.init(),
    PlannedExpenseModel.init(),
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
    PlannedExpenseModel.deleteMany({}),
    TransactionModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();
  const [travel, gift] = await CategoryModel.create([
    { userId, name: 'Travel', type: 'EXPENSE' },
    { userId, name: 'Gifts', type: 'EXPENSE' },
  ]);
  const account = await AccountModel.create({
    userId,
    name: 'Cash',
    type: 'CASH',
    openingBalancePaise: 100_000,
    openingBalanceDate: new Date('2026-11-01T00:00:00.000Z'),
  });
  travelCategoryId = travel._id.toString();
  giftCategoryId = gift._id.toString();
  accountId = account._id.toString();
});

describe('planned expense campaigns', () => {
  it('enforces lifecycle transitions and makes terminal campaigns read-only until reopened', async () => {
    const user = userId.toString();
    const campaign = await createPlannedExpense(user, {
      name: 'Weekend trip',
      items: [{ name: 'Stay', categoryId: travelCategoryId, estimatedAmount: 8_000 }],
    });

    const completed = await updatePlannedExpense(user, campaign.id, { status: 'COMPLETED' });
    expect(completed.status).toBe('COMPLETED');
    await expect(updatePlannedExpense(user, campaign.id, { name: 'Changed trip' }))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(updatePlannedExpense(user, campaign.id, {
      items: [{ id: campaign.items[0].id, name: 'Stay', categoryId: travelCategoryId, estimatedAmount: 9_000 }],
    })).rejects.toMatchObject({ statusCode: 409 });
    await expect(updatePlannedExpense(user, campaign.id, { status: 'CANCELLED' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(deletePlannedExpense(user, campaign.id))
      .rejects.toMatchObject({ statusCode: 409 });

    const reopened = await updatePlannedExpense(user, campaign.id, { status: 'PLANNED' });
    expect(reopened.status).toBe('PLANNED');
    const edited = await updatePlannedExpense(user, campaign.id, { name: 'Changed trip' });
    expect(edited.name).toBe('Changed trip');
    await updatePlannedExpense(user, campaign.id, { status: 'CANCELLED' });
    await expect(deletePlannedExpense(user, campaign.id)).rejects.toMatchObject({ statusCode: 409 });

    const emptyCampaign = await createPlannedExpense(user, {
      name: 'Unused plan',
      items: [{ name: 'Tickets', categoryId: travelCategoryId, estimatedAmount: 1_000 }],
    });
    await expect(deletePlannedExpense(user, emptyCampaign.id)).resolves.toEqual({ id: emptyCampaign.id });
    expect(await PlannedExpenseModel.findById(emptyCampaign.id)).toMatchObject({ isDeleted: true });
    expect((await listPlannedExpenses(user)).some((campaign) => campaign.id === emptyCampaign.id)).toBe(false);
  });

  it('locks spent line identity while allowing estimate changes and edits to unspent lines', async () => {
    const user = userId.toString();
    const campaign = await createPlannedExpense(user, {
      name: 'Wedding',
      items: [
        { name: 'Travel', categoryId: travelCategoryId, accountId, estimatedAmount: 10_000 },
        { name: 'Gift', categoryId: giftCategoryId, estimatedAmount: 5_000 },
      ],
    });
    const [travel, gift] = campaign.items;
    await recordCampaignSpend(user, campaign.id, {
      itemId: travel.id,
      amount: 2_000,
      transactionDate: '2026-11-03',
      accountId,
      paymentMode: 'CASH',
    }, 'locked-line-spend');

    await expect(updatePlannedExpense(user, campaign.id, {
      items: [{ id: gift.id, name: gift.name, categoryId: giftCategoryId, estimatedAmount: gift.estimatedAmount }],
    })).rejects.toMatchObject({ statusCode: 409 });
    await expect(updatePlannedExpense(user, campaign.id, {
      items: [
        { id: travel.id, name: 'Train tickets', categoryId: travelCategoryId, estimatedAmount: 10_000 },
        { id: gift.id, name: gift.name, categoryId: giftCategoryId, estimatedAmount: gift.estimatedAmount },
      ],
    })).rejects.toMatchObject({ statusCode: 409 });
    await expect(updatePlannedExpense(user, campaign.id, {
      items: [
        { id: travel.id, name: travel.name, categoryId: giftCategoryId, estimatedAmount: 10_000 },
        { id: gift.id, name: gift.name, categoryId: giftCategoryId, estimatedAmount: gift.estimatedAmount },
      ],
    })).rejects.toMatchObject({ statusCode: 409 });

    const updated = await updatePlannedExpense(user, campaign.id, {
      items: [
        { id: travel.id, name: travel.name, categoryId: travelCategoryId, estimatedAmount: 12_000 },
        { id: gift.id, name: 'Updated gift', categoryId: giftCategoryId, estimatedAmount: 6_000 },
        { name: 'Outfit', categoryId: giftCategoryId, estimatedAmount: 3_000 },
      ],
    });
    expect(updated.items.map((item) => item.name)).toEqual(['Travel', 'Updated gift', 'Outfit']);
    expect(updated.items[0].accountId).toBe(accountId);
    expect(updated.summary).toMatchObject({ estimatedAmount: 21_000, spentAmount: 2_000 });
  });

  it('soft-deletes removed campaign lines while omitting them from the active campaign view', async () => {
    const user = userId.toString();
    const campaign = await createPlannedExpense(user, {
      name: 'Two line campaign',
      items: [
        { name: 'Keep', categoryId: travelCategoryId, estimatedAmount: 2_000 },
        { name: 'Remove', categoryId: giftCategoryId, estimatedAmount: 1_000 },
      ],
    });
    const keep = campaign.items.find((item) => item.name === 'Keep')!;

    const updated = await updatePlannedExpense(user, campaign.id, {
      items: [{ id: keep.id, name: keep.name, categoryId: travelCategoryId, estimatedAmount: keep.estimatedAmount }],
    });
    const stored = await PlannedExpenseModel.findById(campaign.id);

    expect(updated.items.map((item) => item.name)).toEqual(['Keep']);
    expect(stored?.items).toHaveLength(2);
    expect(stored?.items.find((item) => item.name === 'Remove')?.isDeleted).toBe(true);
  });

  it('only allows transaction-section edits while the linked campaign is planned', async () => {
    const user = userId.toString();
    const campaign = await createPlannedExpense(user, {
      name: 'Conference trip',
      items: [{ name: 'Travel', categoryId: travelCategoryId, estimatedAmount: 10_000 }],
    });
    const [item] = campaign.items;
    await recordCampaignSpend(user, campaign.id, {
      itemId: item.id,
      amount: 4_000,
      transactionDate: '2026-11-03',
      accountId,
      paymentMode: 'CASH',
    }, 'campaign-transaction-lock');
    let listed = await listTransactions(user, {
      page: 1,
      limit: 20,
      sortBy: 'transactionDate',
      sortOrder: 'desc',
    });
    const expenseId = listed.items[0].id;
    expect(listed.items[0].plannedExpenseStatus).toBe('PLANNED');

    const refund = await createTransaction(user, {
      type: 'REFUND',
      amount: 500,
      transactionDate: '2026-11-04',
      categoryId: travelCategoryId,
      paymentMode: 'CASH',
      accountId,
      linkedTransactionId: expenseId,
    });
    await updatePlannedExpense(user, campaign.id, { status: 'COMPLETED' });
    listed = await listTransactions(user, {
      page: 1,
      limit: 20,
      sortBy: 'transactionDate',
      sortOrder: 'desc',
    });
    expect(listed.items.find((transaction) => transaction.id === expenseId)?.plannedExpenseStatus).toBe('COMPLETED');
    expect(listed.items.find((transaction) => transaction.id === refund.id)).toMatchObject({
      plannedExpenseId: campaign.id,
      plannedExpenseStatus: 'COMPLETED',
    });
    await expect(updateTransaction(user, expenseId, { amount: 4_500 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(deleteTransaction(user, expenseId)).rejects.toMatchObject({ statusCode: 409 });
    await expect(updateTransaction(user, refund.id, { amount: 400 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(deleteTransaction(user, refund.id)).rejects.toMatchObject({ statusCode: 409 });

    await updatePlannedExpense(user, campaign.id, { status: 'PLANNED' });
    await expect(updateTransaction(user, expenseId, { amount: 4_500 })).resolves.toMatchObject({ amount: 4_500 });
    await updatePlannedExpense(user, campaign.id, { status: 'CANCELLED' });
    await expect(deleteTransaction(user, expenseId)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creates linked ledger entries in chunks and keeps campaign actuals in sync with edits, refunds, and deletes', async () => {
    const user = userId.toString();
    const campaign = await createPlannedExpense(user, {
      name: 'Friends wedding',
      dueDate: '2026-11-20',
      notes: 'Travel and gift',
      items: [
        { name: 'Travel', categoryId: travelCategoryId, accountId, estimatedAmount: 10_000 },
        { name: 'Gift', categoryId: giftCategoryId, estimatedAmount: 5_000 },
      ],
    });

    expect(campaign.summary).toMatchObject({ estimatedAmount: 15_000, spentAmount: 0, remainingAmount: 15_000 });
    const [travelItem, giftItem] = campaign.items;
    expect(travelItem).toMatchObject({ accountId, accountName: 'Cash' });
    const afterFirstChunk = await recordCampaignSpend(user, campaign.id, {
      itemId: travelItem.id,
      amount: 3_000,
      transactionDate: '2026-11-03',
      accountId,
      paymentMode: 'CASH',
      note: 'Train tickets',
    }, 'campaign-spend-1');
    const afterSecondChunk = await recordCampaignSpend(user, campaign.id, {
      itemId: travelItem.id,
      amount: 2_000,
      transactionDate: '2026-11-04',
      accountId,
      paymentMode: 'UPI',
      note: 'Cab',
    }, 'campaign-spend-2');
    await recordCampaignSpend(user, campaign.id, {
      itemId: giftItem.id,
      amount: 1_000,
      transactionDate: '2026-11-05',
      accountId,
      paymentMode: 'CASH',
    }, 'campaign-spend-3');

    expect(afterFirstChunk.items[0].spentAmount).toBe(3_000);
    expect(afterFirstChunk.items[0].transactions[0]).toMatchObject({
      accountId,
      paymentMode: 'CASH',
      amount: 3_000,
    });
    expect(afterSecondChunk.items[0]).toMatchObject({ spentAmount: 5_000, remainingAmount: 5_000 });
    let updated = (await listPlannedExpenses(user))[0];
    expect(updated.summary).toMatchObject({ estimatedAmount: 15_000, spentAmount: 6_000, remainingAmount: 9_000, transactionCount: 3 });
    const travelTransactions = updated.items.find((item) => item.name === 'Travel')?.transactions ?? [];
    expect(travelTransactions).toHaveLength(2);
    const firstExpense = await TransactionModel.findById(travelTransactions[0].id);
    expect(firstExpense).toMatchObject({
      type: 'EXPENSE',
      plannedExpenseId: new Types.ObjectId(campaign.id),
      plannedExpenseItemId: travelItem.id,
    });

    const refund = await createTransaction(user, {
      type: 'REFUND',
      amount: 500,
      transactionDate: '2026-11-06',
      categoryId: travelCategoryId,
      paymentMode: 'CASH',
      accountId,
      linkedTransactionId: travelTransactions[0].id,
    });
    updated = (await listPlannedExpenses(user))[0];
    expect(updated.summary.spentAmount).toBe(5_500);
    expect((await getMonthlySpendingByCategory(user, 2026, 11)).find((item) => item.categoryId === travelCategoryId)?.actualSpent).toBe(4_500);

    await updateTransaction(user, travelTransactions[0].id, { amount: 3_500 });
    updated = (await listPlannedExpenses(user))[0];
    expect(updated.summary.spentAmount).toBe(7_000);
    expect(updated.items.find((item) => item.name === 'Travel')?.spentAmount).toBe(6_000);

    await deleteTransaction(user, travelTransactions[1].id);
    updated = (await listPlannedExpenses(user))[0];
    expect(updated.summary.spentAmount).toBe(4_000);
    expect(updated.summary.transactionCount).toBe(2);
    await expect(deletePlannedExpense(user, campaign.id)).rejects.toMatchObject({ statusCode: 409 });

    const edited = await updatePlannedExpense(user, campaign.id, {
      items: [
        { id: travelItem.id, name: 'Travel', categoryId: travelCategoryId, estimatedAmount: 12_000 },
        { id: giftItem.id, name: 'Gift', categoryId: giftCategoryId, estimatedAmount: 5_000 },
      ],
    });
    expect(edited.summary).toMatchObject({ estimatedAmount: 17_000, spentAmount: 4_000 });
    expect(await TransactionModel.countDocuments({ userId, type: 'EXPENSE', isDeleted: false })).toBe(2);
    expect(await TransactionModel.findById(refund.id)).not.toBeNull();
  });
});
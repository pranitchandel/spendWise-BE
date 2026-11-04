import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError.js';
import { formatDateIST, startOfDayIST } from '../../shared/utils/date.js';
import { addPaise, subtractPaise, toPaise, toRupees } from '../../shared/utils/money.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import type { PaymentMode } from '../../shared/constants/index.js';
import { CategoryModel } from '../categories/category.model.js';
import { TransactionModel } from '../transactions/transaction.model.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { PlannedExpenseModel, type PlannedExpenseDocument } from './planned-expense.model.js';

type CampaignItemInput = { id?: string; name: string; categoryId: string; estimatedAmount: number };
type CampaignInput = {
  name?: string;
  dueDate?: string | null;
  items?: CampaignItemInput[];
  status?: 'PLANNED' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
};
type SpendInput = {
  itemId: string;
  amount: number;
  transactionDate: string;
  accountId: string;
  paymentMode: PaymentMode;
  note?: string;
  categoryId?: string;
};

async function validateCategory(userId: string, categoryId: string) {
  const category = await CategoryModel.findOne({
    _id: toObjectId(categoryId, 'categoryId'),
    userId: toObjectId(userId, 'userId'),
    type: 'EXPENSE',
    isArchived: false,
  });
  if (!category) throw new NotFoundError('Expense category');
  return category;
}

async function serializeCampaigns(campaigns: PlannedExpenseDocument[], userId: string) {
  if (!campaigns.length) return [];
  const campaignIds = campaigns.map((campaign) => campaign._id);
  const actualTransactions = await TransactionModel.find({
    userId: toObjectId(userId, 'userId'),
    plannedExpenseId: { $in: campaignIds },
    type: 'EXPENSE',
    isDeleted: false,
  }).sort({ transactionDate: -1, createdAt: -1 });
  const refunds = actualTransactions.length
    ? await TransactionModel.find({
        userId: toObjectId(userId, 'userId'),
        type: 'REFUND',
        linkedTransactionId: { $in: actualTransactions.map((transaction) => transaction._id) },
        isDeleted: false,
      })
    : [];
  const categoryIds = new Set<string>();
  for (const campaign of campaigns) {
    if (campaign.categoryId) categoryIds.add(campaign.categoryId.toString());
    for (const item of campaign.items) categoryIds.add(item.categoryId.toString());
  }
  for (const transaction of actualTransactions) categoryIds.add(transaction.categoryId.toString());
  const categories = await CategoryModel.find({
    userId: toObjectId(userId, 'userId'),
    _id: { $in: [...categoryIds].map((id) => new Types.ObjectId(id)) },
  }).select('name').lean();
  const categoryNames = new Map(categories.map((category) => [category._id.toString(), category.name]));
  const refundsByTransaction = new Map<string, number>();
  for (const refund of refunds) {
    if (!refund.linkedTransactionId) continue;
    const key = refund.linkedTransactionId.toString();
    refundsByTransaction.set(key, addPaise(refundsByTransaction.get(key) ?? 0, refund.amountPaise));
  }

  return campaigns.map((campaign) => {
    const campaignTransactions = actualTransactions.filter(
      (transaction) => transaction.plannedExpenseId?.toString() === campaign._id.toString(),
    );
    const storedItems = campaign.items.length
      ? campaign.items.map((item) => ({
          id: item._id.toString(),
          name: item.name,
          categoryId: item.categoryId.toString(),
          estimatedAmountPaise: item.estimatedAmountPaise,
        }))
      : [{
          id: 'legacy',
          name: 'General expense',
          categoryId: campaign.categoryId?.toString() ?? '',
          estimatedAmountPaise: campaign.estimatedAmountPaise,
        }];
    const items = storedItems.map((item) => {
      const itemTransactions = campaignTransactions.filter(
        (transaction) => transaction.plannedExpenseItemId === item.id,
      );
      const spentPaise = itemTransactions.reduce((total, transaction) => {
        const net = subtractPaise(
          transaction.amountPaise,
          refundsByTransaction.get(transaction._id.toString()) ?? 0,
        );
        return addPaise(total, Math.max(0, net));
      }, 0);
      const categoryId = item.categoryId || itemTransactions[0]?.categoryId.toString() || null;
      return {
        id: item.id,
        name: item.name,
        categoryId,
        categoryName: categoryId ? categoryNames.get(categoryId) ?? null : null,
        estimatedAmount: toRupees(item.estimatedAmountPaise),
        spentAmount: toRupees(spentPaise),
        remainingAmount: toRupees(subtractPaise(item.estimatedAmountPaise, spentPaise)),
        overBudgetAmount: toRupees(Math.max(0, subtractPaise(spentPaise, item.estimatedAmountPaise))),
        spendingPercent: item.estimatedAmountPaise > 0
          ? Math.round((spentPaise / item.estimatedAmountPaise) * 100)
          : 0,
        transactions: itemTransactions.map((transaction) => ({
          id: transaction._id.toString(),
          amount: toRupees(transaction.amountPaise),
          date: formatDateIST(transaction.transactionDate),
          accountId: transaction.accountId.toString(),
          paymentMode: transaction.paymentMode,
          description: transaction.description,
          note: transaction.note,
          refundedAmount: toRupees(refundsByTransaction.get(transaction._id.toString()) ?? 0),
        })),
      };
    });
    const estimatedPaise = items.reduce((total, item) => addPaise(total, toPaise(item.estimatedAmount)), 0);
    const spentPaise = items.reduce((total, item) => addPaise(total, toPaise(item.spentAmount)), 0);
    return {
      id: campaign._id.toString(),
      name: campaign.name,
      dueDate: campaign.dueDate ? formatDateIST(campaign.dueDate) : null,
      status: campaign.status,
      notes: campaign.notes,
      items,
      summary: {
        estimatedAmount: toRupees(estimatedPaise),
        spentAmount: toRupees(spentPaise),
        remainingAmount: toRupees(subtractPaise(estimatedPaise, spentPaise)),
        overBudgetAmount: toRupees(Math.max(0, subtractPaise(spentPaise, estimatedPaise))),
        spendingPercent: estimatedPaise > 0 ? Math.round((spentPaise / estimatedPaise) * 100) : 0,
        transactionCount: items.reduce((total, item) => total + item.transactions.length, 0),
      },
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  });
}

export async function listPlannedExpenses(userId: string) {
  const campaigns = await PlannedExpenseModel.find({ userId: toObjectId(userId, 'userId') })
    .sort({ dueDate: 1, createdAt: -1 });
  return serializeCampaigns(campaigns, userId);
}

export async function createPlannedExpense(userId: string, input: Required<Pick<CampaignInput, 'name' | 'items'>> & CampaignInput) {
  if (input.status && input.status !== 'PLANNED') {
    throw new ValidationError('Campaigns must be created in planned status');
  }
  if (!input.items.length) throw new ValidationError('Add at least one campaign item');
  const uid = toObjectId(userId, 'userId');
  const categories = await Promise.all(input.items.map((item) => validateCategory(userId, item.categoryId)));
  const itemAmounts = input.items.map((item) => toPaise(item.estimatedAmount));
  if (itemAmounts.some((amount) => amount <= 0)) throw new ValidationError('Each estimate must be greater than zero');
  const estimatedAmountPaise = itemAmounts.reduce((total, amount) => addPaise(total, amount), 0);
  const campaign = await PlannedExpenseModel.create({
    userId: uid,
    name: input.name.trim(),
    dueDate: input.dueDate ? startOfDayIST(input.dueDate) : null,
    categoryId: null,
    estimatedAmountPaise,
    paidAmountPaise: 0,
    status: input.status ?? 'PLANNED',
    notes: input.notes ?? '',
    items: input.items.map((item, index) => ({
      name: item.name.trim(),
      categoryId: categories[index]._id,
      estimatedAmountPaise: itemAmounts[index],
    })),
  });
  return (await serializeCampaigns([campaign], userId))[0];
}

export async function updatePlannedExpense(userId: string, id: string, input: CampaignInput) {
  const campaign = await PlannedExpenseModel.findOne({ _id: toObjectId(id), userId: toObjectId(userId, 'userId') });
  if (!campaign) throw new NotFoundError('Planned expense campaign');
  const hasNonStatusChanges = Object.keys(input).some((key) => key !== 'status');
  if (campaign.status !== 'PLANNED' && hasNonStatusChanges) {
    throw new ConflictError('Completed or cancelled campaigns must be reopened before they can be edited.');
  }
  if (campaign.status !== 'PLANNED' && input.status !== 'PLANNED') {
    throw new ValidationError('Completed or cancelled campaigns can only be reopened.');
  }
  if (
    input.status !== undefined &&
    input.status !== campaign.status &&
    hasNonStatusChanges
  ) {
    throw new ValidationError('Change campaign details separately from its status.');
  }
  if (input.name !== undefined) campaign.name = input.name.trim();
  if (input.dueDate !== undefined) campaign.dueDate = input.dueDate ? startOfDayIST(input.dueDate) : null;
  if (input.status !== undefined) campaign.status = input.status;
  if (input.notes !== undefined) campaign.notes = input.notes;
  if (input.items !== undefined) {
    if (campaign.status !== 'PLANNED') {
      throw new ConflictError('Reopen the campaign before editing estimate lines.');
    }
    if (!input.items.length) throw new ValidationError('A campaign must have at least one item');
    const validatedItems = await Promise.all(input.items.map(async (item) => ({
      item,
      category: await validateCategory(userId, item.categoryId),
      estimatePaise: toPaise(item.estimatedAmount),
    })));
    if (validatedItems.some(({ estimatePaise }) => estimatePaise <= 0)) {
      throw new ValidationError('Each estimate must be greater than zero');
    }
    const existingIds = new Set(campaign.items.map((item) => item._id.toString()));
    const incomingIds = input.items.map((item) => item.id).filter((value): value is string => Boolean(value));
    if (new Set(incomingIds).size !== incomingIds.length) {
      throw new ValidationError('Campaign item IDs must be unique');
    }
    for (const incomingId of incomingIds) {
      if (incomingId !== 'legacy' && !existingIds.has(incomingId)) {
        throw new ValidationError('Campaign item does not belong to this campaign');
      }
      if (incomingId === 'legacy' && campaign.items.length > 0) {
        throw new ValidationError('Legacy item ID is no longer valid');
      }
    }
    const transactions = await TransactionModel.find({
      userId: toObjectId(userId, 'userId'),
      plannedExpenseId: campaign._id,
      isDeleted: false,
      type: 'EXPENSE',
    }).select('plannedExpenseItemId categoryId');
    for (const transaction of transactions) {
      const linkedItemId = transaction.plannedExpenseItemId;
      if (!linkedItemId || (existingIds.has(linkedItemId) && !incomingIds.includes(linkedItemId))) {
        throw new ConflictError('Campaign items with recorded spending cannot be removed.');
      }
      const priorItem = campaign.items.id(linkedItemId);
      const incoming = validatedItems.find(({ item }) => item.id === linkedItemId);
      if (priorItem && incoming && priorItem.name !== incoming.item.name.trim()) {
        throw new ConflictError('An item name cannot change after spending has been recorded.');
      }
      if (priorItem && incoming && priorItem.categoryId.toString() !== incoming.category._id.toString()) {
        throw new ConflictError('An item category cannot change after spending has been recorded.');
      }
    }
    campaign.items.splice(0, campaign.items.length);
    for (const { item, category, estimatePaise } of validatedItems) {
      campaign.items.push({
        ...(item.id && existingIds.has(item.id) ? { _id: new Types.ObjectId(item.id) } : {}),
        name: item.name.trim(),
        categoryId: category._id,
        estimatedAmountPaise: estimatePaise,
      });
    }
    campaign.estimatedAmountPaise = validatedItems.reduce(
      (total, { estimatePaise }) => addPaise(total, estimatePaise),
      0,
    );
  }
  await campaign.save();
  return (await serializeCampaigns([campaign], userId))[0];
}

export async function recordCampaignSpend(
  userId: string,
  id: string,
  input: SpendInput,
  idempotencyKey?: string,
) {
  const uid = toObjectId(userId, 'userId');
  const campaign = await PlannedExpenseModel.findOne({ _id: toObjectId(id), userId: uid });
  if (!campaign) throw new NotFoundError('Planned expense campaign');
  if (campaign.status !== 'PLANNED') throw new ValidationError('Only active campaigns can record spending');
  const amountPaise = toPaise(input.amount);
  if (amountPaise <= 0) throw new ValidationError('Amount must be greater than zero');

  let item = campaign.items.id(input.itemId);
  if (!item && input.itemId === 'legacy' && input.categoryId) {
    const category = await validateCategory(userId, input.categoryId);
    campaign.items.push({
      name: 'General expense',
      categoryId: category._id,
      estimatedAmountPaise: campaign.estimatedAmountPaise,
    });
    await campaign.save();
    item = campaign.items[campaign.items.length - 1] ?? null;
  }
  if (!item) throw new NotFoundError('Campaign item');

  const categoryId = item.categoryId.toString();
  const category = await validateCategory(userId, categoryId);
  await createTransaction(
    userId,
    {
      type: 'EXPENSE',
      amount: input.amount,
      transactionDate: input.transactionDate,
      categoryId: category._id.toString(),
      accountId: input.accountId,
      paymentMode: input.paymentMode,
      description: `${campaign.name} / ${item.name}`,
      note: input.note ?? '',
      idempotencyKey: idempotencyKey ?? randomUUID(),
    },
    idempotencyKey,
    undefined,
    { plannedExpenseId: campaign._id.toString(), plannedExpenseItemId: item._id.toString() },
  );
  const refreshed = await PlannedExpenseModel.findOne({ _id: campaign._id, userId: uid });
  return (await serializeCampaigns(refreshed ? [refreshed] : [], userId))[0];
}

export async function deletePlannedExpense(userId: string, id: string) {
  const uid = toObjectId(userId, 'userId');
  const campaign = await PlannedExpenseModel.findOne({ _id: toObjectId(id), userId: uid });
  if (!campaign) throw new NotFoundError('Planned expense campaign');
  if (campaign.status !== 'PLANNED') {
    throw new ConflictError('Only planned campaigns can be deleted. Reopen the campaign first.');
  }
  const hasFinancialHistory = await TransactionModel.exists({ userId: uid, plannedExpenseId: campaign._id });
  if (hasFinancialHistory) throw new ConflictError('A campaign with linked transactions cannot be deleted. Cancel it to preserve its financial history.');
  await campaign.deleteOne();
  return { id: campaign._id.toString() };
}
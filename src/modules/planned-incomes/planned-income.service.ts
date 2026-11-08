import { Types } from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError.js';
import type { PaymentMode } from '../../shared/constants/index.js';
import { formatDateIST, startOfDayIST } from '../../shared/utils/date.js';
import { toPaise, toRupees } from '../../shared/utils/money.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { buildPaginationMeta, normalizePagination } from '../../shared/utils/pagination.js';
import { AccountModel } from '../accounts/account.model.js';
import { CategoryModel } from '../categories/category.model.js';
import { TransactionModel } from '../transactions/transaction.model.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { PlannedIncomeModel, type PlannedIncomeDocument } from './planned-income.model.js';

type PlannedIncomeInput = {
  name?: string;
  amount?: number;
  accountId?: string;
  startDate?: string;
  frequency?: 'ONCE' | 'MONTHLY';
  endDate?: string | null;
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
};

async function validateAccount(userId: string, accountId: string) {
  const account = await AccountModel.findOne({
    _id: toObjectId(accountId, 'accountId'),
    userId: toObjectId(userId, 'userId'),
    isArchived: false,
    isActive: true,
  });
  if (!account) throw new NotFoundError('Active income account');
  return account;
}

function scheduledDatesMatch(startDate: Date, frequency: 'ONCE' | 'MONTHLY', endDate: Date | null | undefined, occurrenceDate: string) {
  const candidate = startOfDayIST(occurrenceDate);
  if (candidate < startOfDayIST(startDate) || (endDate && candidate > startOfDayIST(endDate))) return false;
  if (frequency === 'ONCE') return formatDateIST(candidate) === formatDateIST(startDate);
  const [startYear, startMonth, startDay] = formatDateIST(startDate).split('-').map(Number);
  const [targetYear, targetMonth, targetDay] = formatDateIST(candidate).split('-').map(Number);
  const monthDifference = (targetYear - startYear) * 12 + targetMonth - startMonth;
  const lastDayOfMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return monthDifference >= 0 && targetDay === Math.min(startDay, lastDayOfMonth);
}

async function serializeIncomes(incomes: PlannedIncomeDocument[], userId: string) {
  if (!incomes.length) return [];
  const transactions = await TransactionModel.find({
    userId: toObjectId(userId, 'userId'),
    plannedIncomeId: { $in: incomes.map((income) => income._id) },
    isDeleted: false,
  }).sort({ transactionDate: -1, createdAt: -1 });
  const accountIds = [...new Set(incomes.map((income) => income.accountId.toString()))].map((id) => new Types.ObjectId(id));
  const accounts = await AccountModel.find({ userId: toObjectId(userId, 'userId'), _id: { $in: accountIds } }).select('_id name').lean();
  const accountNames = new Map(accounts.map((account) => [account._id.toString(), account.name]));

  return incomes.map((income) => ({
    id: income._id.toString(),
    name: income.name,
    amount: toRupees(income.amountPaise),
    accountId: income.accountId.toString(),
    accountName: accountNames.get(income.accountId.toString()) ?? 'Account',
    startDate: formatDateIST(income.startDate),
    frequency: income.frequency,
    endDate: income.endDate ? formatDateIST(income.endDate) : null,
    status: income.status,
    notes: income.notes,
    actuals: transactions.filter((transaction) => transaction.plannedIncomeId?.toString() === income._id.toString()).map((transaction) => ({
      id: transaction._id.toString(),
      scheduledDate: transaction.plannedIncomeOccurrenceDate ? formatDateIST(transaction.plannedIncomeOccurrenceDate) : formatDateIST(transaction.transactionDate),
      actualDate: formatDateIST(transaction.transactionDate),
      amount: toRupees(transaction.amountPaise),
      accountId: transaction.accountId.toString(),
      paymentMode: transaction.paymentMode,
    })),
    createdAt: income.createdAt,
    updatedAt: income.updatedAt,
  }));
}

export async function listPlannedIncomes(userId: string, query: { page?: number; limit?: number; status?: string } = {}) {
  const filter: Record<string, unknown> = { userId: toObjectId(userId, 'userId'), isDeleted: { $ne: true } };
  if (query.status) filter.status = query.status;
  const { page, limit, skip } = normalizePagination(query);
  const [total, incomes] = await Promise.all([
    PlannedIncomeModel.countDocuments(filter),
    PlannedIncomeModel.find(filter).sort({ startDate: 1, createdAt: -1, _id: -1 }).skip(skip).limit(limit),
  ]);
  const items = await serializeIncomes(incomes, userId);
  if (query.page === undefined && query.limit === undefined && query.status === undefined) return items;
  return { items, ...buildPaginationMeta(total, page, limit) };
}

export async function createPlannedIncome(userId: string, input: Required<Pick<PlannedIncomeInput, 'name' | 'amount' | 'accountId' | 'startDate' | 'frequency'>> & PlannedIncomeInput) {
  if (input.amount <= 0) throw new ValidationError('Planned income must be greater than zero');
  if (input.endDate && input.endDate < input.startDate) throw new ValidationError('End date must be on or after the first income date');
  const account = await validateAccount(userId, input.accountId);
  const income = await PlannedIncomeModel.create({
    userId: toObjectId(userId, 'userId'),
    name: input.name.trim(),
    amountPaise: toPaise(input.amount),
    accountId: account._id,
    startDate: startOfDayIST(input.startDate),
    frequency: input.frequency,
    endDate: input.endDate ? startOfDayIST(input.endDate) : null,
    status: 'ACTIVE',
    notes: input.notes ?? '',
  });
  return (await serializeIncomes([income], userId))[0];
}

export async function updatePlannedIncome(userId: string, id: string, input: PlannedIncomeInput) {
  const income = await PlannedIncomeModel.findOne({ _id: toObjectId(id), userId: toObjectId(userId, 'userId'), isDeleted: { $ne: true } });
  if (!income) throw new NotFoundError('Planned income');
  const detailsChanged = Object.keys(input).some((key) => key !== 'status');
  if (income.status !== 'ACTIVE' && detailsChanged) throw new ConflictError('Reopen the income plan before editing it.');
  if (income.status !== 'ACTIVE' && input.status !== undefined && input.status !== 'ACTIVE') {
    throw new ValidationError('Completed or cancelled income plans can only be reopened.');
  }
  if (input.amount !== undefined && input.amount <= 0) throw new ValidationError('Planned income must be greater than zero');
  const nextStartDate = input.startDate ?? formatDateIST(income.startDate);
  const nextEndDate = input.endDate === undefined ? income.endDate : input.endDate ? startOfDayIST(input.endDate) : null;
  if (nextEndDate && nextEndDate < startOfDayIST(nextStartDate)) throw new ValidationError('End date must be on or after the first income date');
  if (input.accountId !== undefined) income.accountId = (await validateAccount(userId, input.accountId))._id;
  if (input.name !== undefined) income.name = input.name.trim();
  if (input.amount !== undefined) income.amountPaise = toPaise(input.amount);
  if (input.startDate !== undefined) income.startDate = startOfDayIST(input.startDate);
  if (input.frequency !== undefined) income.frequency = input.frequency;
  if (input.endDate !== undefined) income.endDate = nextEndDate;
  if (input.status !== undefined) income.status = input.status;
  if (input.notes !== undefined) income.notes = input.notes;
  await income.save();
  return (await serializeIncomes([income], userId))[0];
}

export async function recordPlannedIncome(
  userId: string,
  id: string,
  input: { scheduledDate: string; actualDate: string; amount: number; paymentMode: PaymentMode; categoryId: string; note?: string },
  idempotencyKey?: string,
) {
  const uid = toObjectId(userId, 'userId');
  const income = await PlannedIncomeModel.findOne({ _id: toObjectId(id), userId: uid, isDeleted: { $ne: true } });
  if (!income) throw new NotFoundError('Planned income');
  if (income.status !== 'ACTIVE') throw new ConflictError('Only active income plans can record actual income.');
  if (!scheduledDatesMatch(income.startDate, income.frequency, income.endDate, input.scheduledDate)) {
    throw new ValidationError('Date does not match this income schedule');
  }
  if (input.amount <= 0) throw new ValidationError('Actual income must be greater than zero');
  const category = await CategoryModel.findOne({
    _id: toObjectId(input.categoryId, 'categoryId'),
    userId: uid,
    type: 'INCOME',
    isArchived: false,
  });
  if (!category) throw new NotFoundError('Income category');
  const occurrenceDate = startOfDayIST(input.scheduledDate);
  if (await TransactionModel.exists({ userId: uid, plannedIncomeId: income._id, plannedIncomeOccurrenceDate: occurrenceDate, isDeleted: false })) {
    throw new ConflictError('Actual income has already been recorded for this scheduled date.');
  }
  await createTransaction(
    userId,
    {
      type: 'INCOME',
      amount: input.amount,
      transactionDate: input.actualDate,
      accountId: income.accountId.toString(),
      categoryId: category._id.toString(),
      paymentMode: input.paymentMode,
      description: income.name,
      note: input.note ?? '',
      idempotencyKey,
    },
    idempotencyKey,
    undefined,
    undefined,
    undefined,
    { plannedIncomeId: income._id.toString(), plannedIncomeOccurrenceDate: formatDateIST(occurrenceDate) },
  );
  const refreshed = await PlannedIncomeModel.findOne({ _id: income._id, userId: uid, isDeleted: { $ne: true } });
  return (await serializeIncomes(refreshed ? [refreshed] : [], userId))[0];
}

export async function deletePlannedIncome(userId: string, id: string) {
  const uid = toObjectId(userId, 'userId');
  const income = await PlannedIncomeModel.findOne({ _id: toObjectId(id), userId: uid, isDeleted: { $ne: true } });
  if (!income) throw new NotFoundError('Planned income');
  if (income.status !== 'ACTIVE') throw new ConflictError('Only active income plans can be deleted. Reopen the plan first.');
  if (await TransactionModel.exists({ userId: uid, plannedIncomeId: income._id, isDeleted: false })) {
    throw new ConflictError('An income plan with actual history cannot be deleted. Cancel it to preserve the ledger link.');
  }
  income.isDeleted = true;
  await income.save();
  return { id: income._id.toString() };
}
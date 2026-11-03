import mongoose, { Types } from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError.js';
import { toIST, startOfDayIST, formatDateIST } from '../../shared/utils/date.js';
import { toPaise, toRupees } from '../../shared/utils/money.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { AccountModel } from '../accounts/account.model.js';
import { CategoryModel } from '../categories/category.model.js';
import { createTransaction } from '../transactions/transaction.service.js';
import type { CreateTransactionInput } from '../transactions/transaction.types.js';
import { RecurringOccurrenceModel, RecurringRuleModel } from './recurring.model.js';
import type { RecurringFrequency, TransactionType } from '../../shared/constants/index.js';
import type { RecurringRuleDocument } from './recurring.model.js';

const FREQUENCY_MONTHS: Partial<Record<RecurringFrequency, number>> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

function addFrequency(date: Date, frequency: RecurringFrequency, scheduleDay: number) {
  const parsed = toIST(date);
  switch (frequency) {
    case 'DAILY': return parsed.add(1, 'day');
    case 'WEEKLY': return parsed.add(1, 'week');
    default: {
      const month = parsed.add(FREQUENCY_MONTHS[frequency] ?? 1, 'month').startOf('month');
      return month.date(Math.min(scheduleDay, month.daysInMonth()));
    }
  }
}

function serializeOccurrence(occurrence: {
  _id: Types.ObjectId;
  dueDate: Date;
  amountPaise: number;
  status: string;
  transactionId?: Types.ObjectId | null;
  postponedTo?: Date | null;
}) {
  return {
    id: occurrence._id.toString(),
    dueDate: formatDateIST(occurrence.dueDate),
    amount: toRupees(occurrence.amountPaise),
    status: occurrence.status,
    paidTransactionId: occurrence.transactionId?.toString() ?? null,
    postponedTo: occurrence.postponedTo ? formatDateIST(occurrence.postponedTo) : null,
  };
}

async function serializeRule(rule: RecurringRuleDocument) {
  const occurrences = await RecurringOccurrenceModel.find({ userId: rule.userId, ruleId: rule._id })
    .sort({ dueDate: 1 });
  return {
    id: rule._id.toString(),
    name: rule.name,
    type: rule.transactionType,
    amount: toRupees(rule.amountPaise),
    frequency: rule.frequency,
    categoryId: rule.categoryId.toString(),
    accountId: rule.accountId.toString(),
    toAccountId: rule.toAccountId?.toString() ?? null,
    paymentMode: rule.paymentMode,
    description: rule.description,
    notes: rule.notes,
    startDate: formatDateIST(rule.startDate),
    scheduleDay: rule.scheduleDay,
    endDate: rule.endDate ? formatDateIST(rule.endDate) : null,
    nextDueDate: formatDateIST(rule.nextDueDate),
    isActive: rule.isActive,
    occurrences: occurrences.map(serializeOccurrence),
  };
}

export async function listRecurring(userId: string) {
  const rules = await RecurringRuleModel.find({ userId: toObjectId(userId, 'userId') }).sort({ nextDueDate: 1 });
  return Promise.all(rules.map(serializeRule));
}

export async function createRecurring(userId: string, input: {
  name: string;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amount: number;
  frequency: RecurringFrequency;
  categoryId: string;
  accountId: string;
  toAccountId?: string | null;
  paymentMode: CreateTransactionInput['paymentMode'];
  description?: string;
  notes?: string;
  startDate: string;
  endDate?: string | null;
}) {
  if (input.amount <= 0) throw new ValidationError('Amount must be greater than zero');
  if (input.type === 'TRANSFER' && (!input.toAccountId || input.toAccountId === input.accountId)) {
    throw new ValidationError('Transfers require a different destination account');
  }

  const uid = toObjectId(userId, 'userId');
  const [account, category, destination] = await Promise.all([
    AccountModel.findOne({ _id: input.accountId, userId: uid, isArchived: false }),
    CategoryModel.findOne({ _id: input.categoryId, userId: uid, isArchived: false }),
    input.toAccountId
      ? AccountModel.findOne({ _id: input.toAccountId, userId: uid, isArchived: false })
      : Promise.resolve(null),
  ]);
  if (!account) throw new NotFoundError('Account');
  if (!category) throw new NotFoundError('Category');
  if (input.toAccountId && !destination) throw new NotFoundError('Destination account');

  const start = startOfDayIST(input.startDate);
  const end = input.endDate ? startOfDayIST(input.endDate) : null;
  if (end && end < start) throw new ValidationError('End date must be on or after start date');
  const rule = await RecurringRuleModel.create({
    userId: uid,
    name: input.name.trim(),
    amountPaise: toPaise(input.amount),
    transactionType: input.type,
    frequency: input.frequency,
    categoryId: category._id,
    accountId: account._id,
    toAccountId: destination?._id ?? null,
    paymentMode: input.paymentMode,
    description: input.description ?? '',
    notes: input.notes ?? '',
    startDate: start,
    scheduleDay: toIST(start).date(),
    endDate: end,
    nextDueDate: start,
  });
  return serializeRule(rule);
}

export async function updateRecurring(userId: string, id: string, input: Record<string, unknown>) {
  const rule = await RecurringRuleModel.findOne({ _id: id, userId: toObjectId(userId, 'userId') });
  if (!rule) throw new NotFoundError('Recurring rule');
  if (input.name !== undefined) rule.name = String(input.name).trim();
  if (input.amount !== undefined) {
    const amount = toPaise(input.amount as number);
    if (amount <= 0) throw new ValidationError('Amount must be greater than zero');
    rule.amountPaise = amount;
  }
  if (input.type !== undefined) rule.transactionType = input.type as 'EXPENSE' | 'INCOME' | 'TRANSFER';
  if (input.frequency !== undefined) rule.frequency = input.frequency as RecurringFrequency;
  const uid = toObjectId(userId, 'userId');
  if (input.categoryId !== undefined) {
    const categoryId = toObjectId(input.categoryId as string, 'categoryId');
    const category = await CategoryModel.findOne({ _id: categoryId, userId: uid, isArchived: false });
    if (!category) throw new NotFoundError('Category');
    rule.categoryId = category._id;
  }
  if (input.accountId !== undefined) {
    const accountId = toObjectId(input.accountId as string, 'accountId');
    const account = await AccountModel.findOne({ _id: accountId, userId: uid, isArchived: false });
    if (!account) throw new NotFoundError('Account');
    rule.accountId = account._id;
  }
  if (input.toAccountId !== undefined) {
    if (!input.toAccountId) {
      rule.toAccountId = null;
    } else {
      const toAccountId = toObjectId(input.toAccountId as string, 'toAccountId');
      const destination = await AccountModel.findOne({ _id: toAccountId, userId: uid, isArchived: false });
      if (!destination) throw new NotFoundError('Destination account');
      rule.toAccountId = destination._id;
    }
  }
  if (input.paymentMode !== undefined) rule.paymentMode = input.paymentMode as typeof rule.paymentMode;
  if (input.description !== undefined) rule.description = String(input.description);
  if (input.notes !== undefined) rule.notes = String(input.notes);
  const updatedStartDate = input.startDate !== undefined
    ? startOfDayIST(input.startDate as string)
    : rule.startDate;
  const updatedEndDate = input.endDate !== undefined
    ? input.endDate ? startOfDayIST(input.endDate as string) : null
    : rule.endDate;
  if (updatedEndDate && updatedEndDate < updatedStartDate) {
    throw new ValidationError('End date must be on or after start date');
  }
  if (input.startDate !== undefined) {
    rule.startDate = updatedStartDate;
    rule.scheduleDay = toIST(updatedStartDate).date();
    if (rule.nextDueDate < updatedStartDate) rule.nextDueDate = updatedStartDate;
  }
  if (input.endDate !== undefined) rule.endDate = updatedEndDate;
  if (input.isActive !== undefined) rule.isActive = Boolean(input.isActive);
  if (rule.transactionType === 'TRANSFER' && (!rule.toAccountId || rule.toAccountId.equals(rule.accountId))) {
    throw new ValidationError('Transfers require a different destination account');
  }
  await rule.save();
  return serializeRule(rule);
}

export async function deleteRecurring(userId: string, id: string) {
  return updateRecurring(userId, id, { isActive: false });
}

export async function generateOccurrences(userId: string, through: string) {
  const uid = toObjectId(userId, 'userId');
  const end = startOfDayIST(through);
  const rules = await RecurringRuleModel.find({ userId: uid, isActive: true, nextDueDate: { $lte: end } });
  let generated = 0;
  for (const rule of rules) {
    let due = toIST(rule.nextDueDate);
    while (due.toDate() <= end && (!rule.endDate || due.toDate() <= rule.endDate)) {
      try {
        await RecurringOccurrenceModel.create({
          userId: uid,
          ruleId: rule._id,
          dueDate: due.startOf('day').toDate(),
          amountPaise: rule.amountPaise,
          status: 'PENDING',
        });
        generated += 1;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      }
      due = addFrequency(due.toDate(), rule.frequency, rule.scheduleDay);
    }
    rule.nextDueDate = due.startOf('day').toDate();
    if (rule.endDate && rule.nextDueDate > rule.endDate) rule.isActive = false;
    await rule.save();
  }
  return { generated };
}

export async function updateOccurrence(userId: string, ruleId: string, occurrenceId: string, input: {
  action: 'PAID' | 'SKIPPED' | 'POSTPONED';
  accountId?: string;
  paymentMode?: CreateTransactionInput['paymentMode'];
  postponedTo?: string;
  note?: string;
}) {
  const uid = toObjectId(userId, 'userId');
  const session = await mongoose.startSession();
  session.startTransaction();
  let ruleIdForResponse: Types.ObjectId;
  try {
    const rule = await RecurringRuleModel.findOne({ _id: ruleId, userId: uid }).session(session);
    const occurrence = await RecurringOccurrenceModel.findOne({ _id: occurrenceId, ruleId, userId: uid }).session(session);
    if (!rule || !occurrence) throw new NotFoundError('Recurring occurrence');
    if (occurrence.status !== 'PENDING') throw new ConflictError('Only pending occurrences can be changed');
    ruleIdForResponse = rule._id;

    if (input.action === 'PAID') {
      if (!input.accountId || !input.paymentMode) {
        throw new ValidationError('Account and payment mode are required to mark paid');
      }
      const transaction = await createTransaction(
        userId,
        {
          amount: toRupees(occurrence.amountPaise),
          transactionDate: formatDateIST(occurrence.dueDate),
          type: rule.transactionType as TransactionType,
          categoryId: rule.categoryId.toString(),
          paymentMode: input.paymentMode,
          accountId: input.accountId,
          toAccountId: rule.toAccountId?.toString() ?? undefined,
          description: rule.description || rule.name,
          note: input.note,
        },
        `recurring-${occurrence._id.toString()}`,
        session,
      );
      occurrence.transactionId = new Types.ObjectId(transaction.id);
      occurrence.status = 'PAID';
    } else if (input.action === 'SKIPPED') {
      occurrence.status = 'SKIPPED';
    } else {
      if (!input.postponedTo) throw new ValidationError('postponedTo is required');
      const nextDate = startOfDayIST(input.postponedTo);
      if (nextDate <= occurrence.dueDate) {
        throw new ValidationError('Postponement date must be after the due date');
      }
      occurrence.status = 'POSTPONED';
      occurrence.postponedTo = nextDate;
    }
    if (input.note !== undefined) occurrence.note = input.note;
    await occurrence.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
  const updatedRule = await RecurringRuleModel.findOne({ _id: ruleIdForResponse!, userId: uid });
  if (!updatedRule) throw new NotFoundError('Recurring rule');
  return serializeRule(updatedRule);
}
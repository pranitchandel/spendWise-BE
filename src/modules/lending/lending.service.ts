import { Types } from 'mongoose';
import { ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { buildPaginationMeta, normalizePagination } from '../../shared/utils/pagination.js';
import { formatDateIST, nowInIST } from '../../shared/utils/date.js';
import { toRupees } from '../../shared/utils/money.js';
import { LendingRecordModel } from './lending.model.js';
import { RepaymentModel } from '../repayments/repayment.model.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../transactions/transaction.service.js';
import { TransactionModel } from '../transactions/transaction.model.js';
import type { CreateTransactionInput } from '../transactions/transaction.types.js';

function toLendingDto(record: {
  _id: { toString(): string };
  personId?: { toString(): string } | null;
  personName: string;
  phone?: string;
  email?: string;
  originalAmountPaise: number;
  lendingDate: Date;
  sourceAccountId: { toString(): string };
  expectedRepaymentDate?: Date | null;
  interestRate?: number | null;
  description?: string;
  notes?: string;
  status: string;
  outstandingPaise: number;
  totalRepaidPaise: number;
  totalInterestReceivedPaise?: number;
  linkedTransactionId: { toString(): string };
}) {
  const overdue =
    record.expectedRepaymentDate &&
    record.outstandingPaise > 0 &&
    record.expectedRepaymentDate < nowInIST().toDate();

  return {
    id: record._id.toString(),
    personId: record.personId?.toString() ?? null,
    personName: record.personName,
    phone: record.phone ?? '',
    email: record.email ?? '',
    originalAmount: toRupees(record.originalAmountPaise),
    lendingDate: formatDateIST(record.lendingDate),
    sourceAccountId: record.sourceAccountId.toString(),
    expectedRepaymentDate: record.expectedRepaymentDate
      ? formatDateIST(record.expectedRepaymentDate)
      : null,
    interestRate: record.interestRate ?? null,
    description: record.description ?? '',
    notes: record.notes ?? '',
    status: overdue ? 'OVERDUE' : record.status,
    outstanding: toRupees(record.outstandingPaise),
    totalRepaid: toRupees(record.totalRepaidPaise),
    totalInterestReceived: toRupees(record.totalInterestReceivedPaise ?? 0),
    linkedTransactionId: record.linkedTransactionId.toString(),
  };
}

export async function listLending(userId: string, input: string | { status?: string; search?: string; page?: number; limit?: number } = {}) {
  const query = typeof input === 'string' ? { status: input } : input;
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), isDeleted: { $ne: true } };
  if (query.status && query.status !== 'ALL') filter.status = query.status;
  if (query.search) filter.$or = [
    { personName: { $regex: query.search, $options: 'i' } },
    { phone: { $regex: query.search, $options: 'i' } },
    { email: { $regex: query.search, $options: 'i' } },
    { description: { $regex: query.search, $options: 'i' } },
    { notes: { $regex: query.search, $options: 'i' } },
  ];
  const { page, limit, skip } = normalizePagination(query);
  const [total, records, summary] = await Promise.all([
    LendingRecordModel.countDocuments(filter),
    LendingRecordModel.find(filter).sort({ lendingDate: -1, _id: -1 }).skip(skip).limit(limit),
    LendingRecordModel.aggregate([{ $match: filter }, { $group: { _id: null, totalOutstanding: { $sum: '$outstandingPaise' } } }]),
  ]);
  const items = records.map(toLendingDto);
  if (typeof input === 'string' || (query.page === undefined && query.limit === undefined)) return items;
  return { items, totalOutstanding: toRupees(summary[0]?.totalOutstanding ?? 0), ...buildPaginationMeta(total, page, limit) };
}

export async function getLending(userId: string, id: string) {
  const record = await LendingRecordModel.findOne({ _id: id, userId, isDeleted: { $ne: true } });
  if (!record) throw new NotFoundError('Lending record');
  const [repayments, transaction] = await Promise.all([
    RepaymentModel.find({
      userId,
      recordType: 'LENDING',
      recordId: id,
      isDeleted: false,
    }).sort({ repaymentDate: -1 }),
    TransactionModel.findOne({ _id: record.linkedTransactionId, userId, isDeleted: false }).select('categoryId paymentMode'),
  ]);

  return {
    ...toLendingDto(record),
    categoryId: transaction?.categoryId.toString() ?? '',
    paymentMode: transaction?.paymentMode ?? 'UPI',
    repayments: repayments.map((r) => ({
      id: r._id.toString(),
      amount: toRupees(r.amountPaise),
      interest: toRupees(r.interestPaise),
      accountId: r.accountId.toString(),
      transactionId: r.transactionId.toString(),
      repaymentDate: formatDateIST(r.repaymentDate),
      notes: r.notes,
    })),
  };
}

export async function createLending(
  userId: string,
  input: CreateTransactionInput & { personName: string },
) {
  return createTransaction(userId, { ...input, type: 'LENDING' });
}

export async function updateLending(
  userId: string,
  id: string,
  input: {
    personName: string;
    phone?: string;
    email?: string;
    amount: number;
    transactionDate: string;
    accountId: string;
    categoryId: string;
    paymentMode: CreateTransactionInput['paymentMode'];
    expectedRepaymentDate?: string | null;
    interestRate?: number | null;
    description?: string;
    notes?: string;
  },
) {
  const record = await LendingRecordModel.findOne({ _id: id, userId, isDeleted: { $ne: true } });
  if (!record) throw new NotFoundError('Lending record');
  const hasRepayments = await RepaymentModel.exists({
    userId,
    recordType: 'LENDING',
    recordId: record._id,
    isDeleted: false,
  });
  if (hasRepayments || record.totalRepaidPaise > 0 || record.totalInterestReceivedPaise > 0) {
    throw new ConflictError('Lending records with repayment history cannot be edited.');
  }
  await updateTransaction(userId, record.linkedTransactionId.toString(), {
    personName: input.personName,
    phone: input.phone,
    email: input.email,
    amount: input.amount,
    transactionDate: input.transactionDate,
    accountId: input.accountId,
    categoryId: input.categoryId,
    paymentMode: input.paymentMode,
    expectedRepaymentDate: input.expectedRepaymentDate,
    interestRate: input.interestRate,
    description: input.description,
    note: input.notes,
  });
  return getLending(userId, id);
}

export async function deleteLending(userId: string, id: string) {
  const record = await LendingRecordModel.findOne({ _id: id, userId, isDeleted: { $ne: true } });
  if (!record) throw new NotFoundError('Lending record');
  return deleteTransaction(userId, record.linkedTransactionId.toString());
}

export async function addRepayment(
  userId: string,
  lendingId: string,
  input: {
    amount: number;
    interestAmount?: number;
    accountId: string;
    categoryId: string;
    paymentMode: CreateTransactionInput['paymentMode'];
    transactionDate: string;
    note?: string;
    idempotencyKey?: string;
  },
) {
  const record = await LendingRecordModel.findOne({ _id: lendingId, userId, isDeleted: { $ne: true } });
  if (!record) throw new NotFoundError('Lending record');

  return createTransaction(userId, {
    type: 'LENDING_REPAYMENT',
    amount: input.amount,
    interestAmount: input.interestAmount,
    accountId: input.accountId,
    categoryId: input.categoryId,
    paymentMode: input.paymentMode,
    transactionDate: input.transactionDate,
    linkedRecordId: lendingId,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
    description: `Repayment from ${record.personName}`,
  });
}

export async function lendingDashboard(userId: string) {
  const records = await LendingRecordModel.find({ userId, isDeleted: { $ne: true } });
  let totalLent = 0;
  let totalRecovered = 0;
  let totalOutstanding = 0;
  let overdueCount = 0;
  const borrowers = new Set<string>();

  for (const r of records) {
    totalLent += r.originalAmountPaise;
    totalRecovered += r.totalRepaidPaise;
    totalOutstanding += r.outstandingPaise;
    borrowers.add(r.personName);
    if (
      r.expectedRepaymentDate &&
      r.outstandingPaise > 0 &&
      r.expectedRepaymentDate < nowInIST().toDate()
    ) {
      overdueCount += 1;
    }
  }

  return {
    totalLent: toRupees(totalLent),
    totalRecovered: toRupees(totalRecovered),
    totalOutstanding: toRupees(totalOutstanding),
    borrowerCount: borrowers.size,
    overdueCount,
    records: records.map(toLendingDto),
  };
}

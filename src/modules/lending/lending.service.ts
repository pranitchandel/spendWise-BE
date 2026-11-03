import { NotFoundError } from '../../shared/errors/AppError.js';
import { nowInIST } from '../../shared/utils/date.js';
import { toRupees } from '../../shared/utils/money.js';
import { LendingRecordModel } from './lending.model.js';
import { RepaymentModel } from '../repayments/repayment.model.js';
import { createTransaction } from '../transactions/transaction.service.js';
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
    lendingDate: record.lendingDate.toISOString().slice(0, 10),
    sourceAccountId: record.sourceAccountId.toString(),
    expectedRepaymentDate: record.expectedRepaymentDate
      ? record.expectedRepaymentDate.toISOString().slice(0, 10)
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

export async function listLending(userId: string, status?: string) {
  const filter: Record<string, unknown> = { userId };
  if (status) filter.status = status;
  const records = await LendingRecordModel.find(filter).sort({ lendingDate: -1 });
  return records.map(toLendingDto);
}

export async function getLending(userId: string, id: string) {
  const record = await LendingRecordModel.findOne({ _id: id, userId });
  if (!record) throw new NotFoundError('Lending record');
  const repayments = await RepaymentModel.find({
    userId,
    recordType: 'LENDING',
    recordId: id,
    isDeleted: false,
  }).sort({ repaymentDate: -1 });

  return {
    ...toLendingDto(record),
    repayments: repayments.map((r) => ({
      id: r._id.toString(),
      amount: toRupees(r.amountPaise),
      interest: toRupees(r.interestPaise),
      accountId: r.accountId.toString(),
      transactionId: r.transactionId.toString(),
      repaymentDate: r.repaymentDate.toISOString().slice(0, 10),
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
  const record = await LendingRecordModel.findOne({ _id: lendingId, userId });
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
  const records = await LendingRecordModel.find({ userId });
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

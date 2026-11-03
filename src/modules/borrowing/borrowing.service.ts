import { NotFoundError } from '../../shared/errors/AppError.js';
import { nowInIST } from '../../shared/utils/date.js';
import { toRupees } from '../../shared/utils/money.js';
import { BorrowingRecordModel } from './borrowing.model.js';
import { RepaymentModel } from '../repayments/repayment.model.js';
import { createTransaction } from '../transactions/transaction.service.js';
import type { CreateTransactionInput } from '../transactions/transaction.types.js';

function toBorrowingDto(record: {
  _id: { toString(): string };
  personId?: { toString(): string } | null;
  lenderName: string;
  phone?: string;
  email?: string;
  originalAmountPaise: number;
  borrowingDate: Date;
  receivingAccountId: { toString(): string };
  expectedRepaymentDate?: Date | null;
  interestRate?: number | null;
  repaymentTerms?: string;
  notes?: string;
  status: string;
  outstandingPaise: number;
  totalRepaidPaise: number;
  totalInterestPaidPaise?: number;
  linkedTransactionId: { toString(): string };
}) {
  const overdue =
    record.expectedRepaymentDate &&
    record.outstandingPaise > 0 &&
    record.expectedRepaymentDate < nowInIST().toDate();

  return {
    id: record._id.toString(),
    personId: record.personId?.toString() ?? null,
    lenderName: record.lenderName,
    phone: record.phone ?? '',
    email: record.email ?? '',
    originalAmount: toRupees(record.originalAmountPaise),
    borrowingDate: record.borrowingDate.toISOString().slice(0, 10),
    receivingAccountId: record.receivingAccountId.toString(),
    expectedRepaymentDate: record.expectedRepaymentDate
      ? record.expectedRepaymentDate.toISOString().slice(0, 10)
      : null,
    interestRate: record.interestRate ?? null,
    repaymentTerms: record.repaymentTerms ?? '',
    notes: record.notes ?? '',
    status: overdue ? 'OVERDUE' : record.status,
    outstanding: toRupees(record.outstandingPaise),
    totalRepaid: toRupees(record.totalRepaidPaise),
    totalInterestPaid: toRupees(record.totalInterestPaidPaise ?? 0),
    linkedTransactionId: record.linkedTransactionId.toString(),
  };
}

export async function listBorrowing(userId: string, status?: string) {
  const filter: Record<string, unknown> = { userId };
  if (status) filter.status = status;
  const records = await BorrowingRecordModel.find(filter).sort({ borrowingDate: -1 });
  return records.map(toBorrowingDto);
}

export async function getBorrowing(userId: string, id: string) {
  const record = await BorrowingRecordModel.findOne({ _id: id, userId });
  if (!record) throw new NotFoundError('Borrowing record');
  const repayments = await RepaymentModel.find({
    userId,
    recordType: 'BORROWING',
    recordId: id,
    isDeleted: false,
  }).sort({ repaymentDate: -1 });

  return {
    ...toBorrowingDto(record),
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

export async function addRepayment(
  userId: string,
  borrowingId: string,
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
  const record = await BorrowingRecordModel.findOne({ _id: borrowingId, userId });
  if (!record) throw new NotFoundError('Borrowing record');

  return createTransaction(userId, {
    type: 'BORROWING_REPAYMENT',
    amount: input.amount,
    interestAmount: input.interestAmount,
    accountId: input.accountId,
    categoryId: input.categoryId,
    paymentMode: input.paymentMode,
    transactionDate: input.transactionDate,
    linkedRecordId: borrowingId,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
    description: `Repayment to ${record.lenderName}`,
  });
}

export async function borrowingDashboard(userId: string) {
  const records = await BorrowingRecordModel.find({ userId });
  let totalBorrowed = 0;
  let totalRepaid = 0;
  let totalOutstanding = 0;
  let overdueCount = 0;
  const lenders = new Set<string>();
  const upcoming = [];

  for (const r of records) {
    totalBorrowed += r.originalAmountPaise;
    totalRepaid += r.totalRepaidPaise;
    totalOutstanding += r.outstandingPaise;
    lenders.add(r.lenderName);
    if (
      r.expectedRepaymentDate &&
      r.outstandingPaise > 0 &&
      r.expectedRepaymentDate < nowInIST().toDate()
    ) {
      overdueCount += 1;
    }
    if (r.expectedRepaymentDate && r.outstandingPaise > 0) {
      upcoming.push(toBorrowingDto(r));
    }
  }

  return {
    totalBorrowed: toRupees(totalBorrowed),
    totalRepaid: toRupees(totalRepaid),
    totalOutstanding: toRupees(totalOutstanding),
    lenderCount: lenders.size,
    overdueCount,
    upcomingRepayments: upcoming.sort((a, b) =>
      (a.expectedRepaymentDate ?? '').localeCompare(b.expectedRepaymentDate ?? ''),
    ),
    records: records.map(toBorrowingDto),
  };
}

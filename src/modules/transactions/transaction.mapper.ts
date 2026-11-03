import { toRupees } from '../../shared/utils/money.js';
import { formatDateIST } from '../../shared/utils/date.js';

export function toTransactionDto(tx: {
  _id: { toString(): string };
  amountPaise: number;
  interestPaise?: number;
  transactionDate: Date;
  transactionTime?: string;
  type: string;
  categoryId: { toString(): string };
  paymentMode: string;
  accountId: { toString(): string };
  toAccountId?: { toString(): string } | null;
  description?: string;
  note?: string;
  tags?: string[];
  personId?: { toString(): string } | null;
  linkedRecordId?: { toString(): string } | null;
  linkedRecordType?: string | null;
  linkedTransactionId?: { toString(): string } | null;
  transferGroupId?: string | null;
  isCreditCardBillPayment?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: tx._id.toString(),
    amount: toRupees(tx.amountPaise),
    amountPaise: tx.amountPaise,
    interestAmount: toRupees(tx.interestPaise ?? 0),
    transactionDate: formatDateIST(tx.transactionDate),
    transactionTime: tx.transactionTime ?? '',
    type: tx.type,
    categoryId: tx.categoryId.toString(),
    paymentMode: tx.paymentMode,
    accountId: tx.accountId.toString(),
    toAccountId: tx.toAccountId ? tx.toAccountId.toString() : null,
    description: tx.description ?? '',
    note: tx.note ?? '',
    tags: tx.tags ?? [],
    personId: tx.personId ? tx.personId.toString() : null,
    linkedRecordId: tx.linkedRecordId ? tx.linkedRecordId.toString() : null,
    linkedRecordType: tx.linkedRecordType ?? null,
    linkedTransactionId: tx.linkedTransactionId
      ? tx.linkedTransactionId.toString()
      : null,
    transferGroupId: tx.transferGroupId ?? null,
    isCreditCardBillPayment: tx.isCreditCardBillPayment ?? false,
    createdAt: tx.createdAt?.toISOString(),
    updatedAt: tx.updatedAt?.toISOString(),
  };
}

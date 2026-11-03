import { z } from 'zod';
import { PAYMENT_MODES, TRANSACTION_TYPES } from '../../shared/constants/index.js';

export const createTransactionSchema = z.object({
  amount: z.number().positive('Amount must be greater than zero'),
  transactionDate: z.string().min(1),
  transactionTime: z.string().optional(),
  type: z.enum(TRANSACTION_TYPES),
  categoryId: z.string().min(1),
  paymentMode: z.enum(PAYMENT_MODES),
  accountId: z.string().min(1),
  toAccountId: z.string().optional().nullable(),
  description: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  personId: z.string().optional().nullable(),
  personName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  linkedRecordId: z.string().optional().nullable(),
  linkedTransactionId: z.string().optional().nullable(),
  interestAmount: z.number().min(0).optional(),
  expectedRepaymentDate: z.string().optional().nullable(),
  interestRate: z.number().optional().nullable(),
  isCreditCardBillPayment: z.boolean().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial().omit({
  type: true,
  linkedRecordId: true,
});

const optionalQueryString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

export const listTransactionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(TRANSACTION_TYPES).optional(),
  ),
  categoryId: optionalQueryString,
  accountId: optionalQueryString,
  search: optionalQueryString,
  from: optionalQueryString,
  to: optionalQueryString,
  sortBy: z.enum(['transactionDate', 'amountPaise', 'createdAt']).default('transactionDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  tags: optionalQueryString,
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>;

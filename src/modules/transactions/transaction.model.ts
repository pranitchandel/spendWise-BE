import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { PAYMENT_MODES, TRANSACTION_TYPES } from '../../shared/constants/index.js';

const transactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amountPaise: { type: Number, required: true, min: 1 },
    refundedPaise: { type: Number, required: true, min: 0, default: 0 },
    transactionDate: { type: Date, required: true },
    transactionTime: { type: String, default: '' },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    interestPaise: { type: Number, required: true, min: 0, default: 0 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    toAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    description: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    tags: { type: [String], default: [] },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    linkedRecordId: { type: Schema.Types.ObjectId, default: null },
    linkedRecordType: {
      type: String,
      enum: ['LENDING', 'BORROWING', 'REPAYMENT'],
      default: null,
    },
    linkedTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    transferGroupId: { type: String, default: null },
    isCreditCardBillPayment: { type: Boolean, default: false },
    idempotencyKey: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, type: 1 });
transactionSchema.index({ userId: 1, categoryId: 1 });
transactionSchema.index({ userId: 1, accountId: 1 });
transactionSchema.index({ userId: 1, linkedRecordId: 1 });
transactionSchema.index({ userId: 1, isDeleted: 1, transactionDate: -1 });
transactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export type TransactionDocument = InferSchemaType<typeof transactionSchema> & {
  _id: Types.ObjectId;
};

export const TransactionModel = model('Transaction', transactionSchema);

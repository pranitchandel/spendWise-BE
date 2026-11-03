import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { BORROWING_STATUSES } from '../../shared/constants/index.js';

const borrowingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    lenderName: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    originalAmountPaise: { type: Number, required: true, min: 1 },
    borrowingDate: { type: Date, required: true },
    receivingAccountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    expectedRepaymentDate: { type: Date, default: null },
    interestRate: { type: Number, default: null },
    repaymentTerms: { type: String, default: '' },
    notes: { type: String, default: '' },
    outstandingPaise: { type: Number, required: true, min: 0 },
    totalRepaidPaise: { type: Number, required: true, default: 0, min: 0 },
    totalInterestPaidPaise: { type: Number, required: true, default: 0, min: 0 },
    status: { type: String, enum: BORROWING_STATUSES, required: true, default: 'ACTIVE' },
    linkedTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

borrowingSchema.index({ userId: 1, personId: 1, status: 1 });
borrowingSchema.index({ userId: 1, status: 1 });
borrowingSchema.index({ userId: 1, isDeleted: 1 });

export type BorrowingDocument = InferSchemaType<typeof borrowingSchema> & {
  _id: Types.ObjectId;
};

export const BorrowingRecordModel = model('BorrowingRecord', borrowingSchema);

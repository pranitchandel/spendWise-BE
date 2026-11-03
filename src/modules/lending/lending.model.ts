import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { LENDING_STATUSES } from '../../shared/constants/index.js';

const lendingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    personName: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    originalAmountPaise: { type: Number, required: true, min: 1 },
    lendingDate: { type: Date, required: true },
    sourceAccountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    expectedRepaymentDate: { type: Date, default: null },
    interestRate: { type: Number, default: null },
    description: { type: String, default: '' },
    notes: { type: String, default: '' },
    outstandingPaise: { type: Number, required: true, min: 0 },
    totalRepaidPaise: { type: Number, required: true, default: 0, min: 0 },
    totalInterestReceivedPaise: { type: Number, required: true, default: 0, min: 0 },
    status: { type: String, enum: LENDING_STATUSES, required: true, default: 'ACTIVE' },
    linkedTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

lendingSchema.index({ userId: 1, personId: 1, status: 1 });
lendingSchema.index({ userId: 1, status: 1 });
lendingSchema.index({ userId: 1, isDeleted: 1 });

export type LendingDocument = InferSchemaType<typeof lendingSchema> & {
  _id: Types.ObjectId;
};

export const LendingRecordModel = model('LendingRecord', lendingSchema);

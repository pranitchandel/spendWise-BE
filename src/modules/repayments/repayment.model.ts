import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const repaymentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recordType: { type: String, enum: ['LENDING', 'BORROWING'], required: true },
    recordId: { type: Schema.Types.ObjectId, required: true, index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    interestPaise: { type: Number, required: true, default: 0, min: 0 },
    repaymentDate: { type: Date, required: true },
    notes: { type: String, default: '' },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

repaymentSchema.index({ userId: 1, recordType: 1, recordId: 1 });
repaymentSchema.index({ userId: 1, repaymentDate: -1 });

export type RepaymentDocument = InferSchemaType<typeof repaymentSchema> & {
  _id: Types.ObjectId;
};

export const RepaymentModel = model('Repayment', repaymentSchema);

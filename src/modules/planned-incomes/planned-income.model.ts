import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const plannedIncomeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    amountPaise: { type: Number, required: true, min: 1 },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    startDate: { type: Date, required: true },
    frequency: { type: String, enum: ['ONCE', 'MONTHLY'], required: true, default: 'ONCE' },
    endDate: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'], required: true, default: 'ACTIVE' },
    notes: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

plannedIncomeSchema.index({ userId: 1, status: 1, startDate: 1 });

export type PlannedIncomeDocument = InferSchemaType<typeof plannedIncomeSchema> & {
  _id: Types.ObjectId;
};

export const PlannedIncomeModel = model('PlannedIncome', plannedIncomeSchema);
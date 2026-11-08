import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

export const SAVINGS_OPTION_TYPES = [
  'BANK_SAVINGS',
  'RECURRING_DEPOSIT',
  'FIXED_DEPOSIT',
  'PPF',
  'MUTUAL_FUND',
  'OTHER',
] as const;

export const SAVINGS_COMPOUNDING_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const;
export const SAVINGS_GOAL_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;

const savingsAllocationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    optionType: { type: String, enum: SAVINGS_OPTION_TYPES, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    expectedAnnualReturnRate: { type: Number, required: true, min: 0, max: 100 },
    compoundingFrequency: { type: String, enum: SAVINGS_COMPOUNDING_FREQUENCIES, required: true },
    monthlyContributionPaise: { type: Number, required: true, min: 0, default: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const savingsGoalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    targetAmountPaise: { type: Number, required: true, min: 1 },
    targetDate: { type: Date, required: true },
    notes: { type: String, default: '' },
    status: { type: String, enum: SAVINGS_GOAL_STATUSES, required: true, default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false },
    allocations: { type: [savingsAllocationSchema], default: [] },
  },
  { timestamps: true },
);

savingsGoalSchema.index({ userId: 1, status: 1, targetDate: 1 });

export type SavingsGoalDocument = InferSchemaType<typeof savingsGoalSchema> & {
  _id: Types.ObjectId;
};

export const SavingsGoalModel = model('SavingsGoal', savingsGoalSchema);
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { TRANSACTION_TYPES } from '../../shared/constants/index.js';

export const ACTIVITY_ACTIONS = ['CREATED', 'UPDATED', 'DELETED'] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_SOURCES = [
  'MANUAL',
  'PLANNED_EXPENSE',
  'PLANNED_INCOME',
  'SAVINGS',
  'LENDING',
  'BORROWING',
  'REPAYMENT',
  'REFUND',
] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

const effectSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    deltaPaise: { type: Number, required: true },
  },
  { _id: false },
);

const changeSchema = new Schema(
  {
    field: { type: String, required: true },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

// Append-only audit trail; entries are written in the same DB session as the ledger change.
const activityLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    action: { type: String, enum: ACTIVITY_ACTIONS, required: true },
    transactionType: { type: String, enum: TRANSACTION_TYPES, required: true },
    source: { type: String, enum: ACTIVITY_SOURCES, required: true },
    amountPaise: { type: Number, required: true },
    // Net account-balance movement this entry caused (credit positive, debit negative).
    effects: { type: [effectSchema], default: [] },
    changes: { type: [changeSchema], default: [] },
    // Full transaction state after create/update, or before delete.
    snapshot: { type: Schema.Types.Mixed, required: true },
    // Account balances and linked loan / campaign / income plan / savings goal state after the change.
    context: { type: Schema.Types.Mixed, default: null },
    occurredAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

activityLogSchema.index({ userId: 1, occurredAt: -1 });
activityLogSchema.index({ userId: 1, transactionId: 1, occurredAt: -1 });
activityLogSchema.index({ userId: 1, action: 1, occurredAt: -1 });

export type ActivityLogDocument = InferSchemaType<typeof activityLogSchema> & { _id: Types.ObjectId };

export const ActivityLogModel = model('TransactionActivityLog', activityLogSchema);

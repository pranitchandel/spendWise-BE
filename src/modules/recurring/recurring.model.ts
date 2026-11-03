import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  OCCURRENCE_STATUSES,
  PAYMENT_MODES,
  RECURRING_FREQUENCIES,
} from '../../shared/constants/index.js';

const recurringRuleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    amountPaise: { type: Number, required: true, min: 1 },
    transactionType: {
      type: String,
      enum: ['EXPENSE', 'INCOME', 'TRANSFER'],
      required: true,
    },
    notes: { type: String, default: '' },
    frequency: { type: String, enum: RECURRING_FREQUENCIES, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    toAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },
    description: { type: String, default: '' },
    startDate: { type: Date, required: true },
    scheduleDay: { type: Number, min: 1, max: 31, required: true },
    endDate: { type: Date, default: null },
    nextDueDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    autoCreate: { type: Boolean, default: false },
  },
  { timestamps: true },
);

recurringRuleSchema.index({ userId: 1, isActive: 1, nextDueDate: 1 });

export type RecurringRuleDocument = InferSchemaType<typeof recurringRuleSchema> & {
  _id: Types.ObjectId;
};

export const RecurringRuleModel = model('RecurringRule', recurringRuleSchema);

const recurringOccurrenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'RecurringRule', required: true, index: true },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: OCCURRENCE_STATUSES, required: true, default: 'PENDING' },
    amountPaise: { type: Number, required: true, min: 1 },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    postponedTo: { type: Date, default: null },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

recurringOccurrenceSchema.index({ userId: 1, ruleId: 1, dueDate: 1 }, { unique: true });
recurringOccurrenceSchema.index({ userId: 1, status: 1, dueDate: 1 });

export type RecurringOccurrenceDocument = InferSchemaType<typeof recurringOccurrenceSchema> & {
  _id: Types.ObjectId;
};

export const RecurringOccurrenceModel = model('RecurringOccurrence', recurringOccurrenceSchema);

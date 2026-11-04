import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const plannedExpenseSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    dueDate: { type: Date, default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    estimatedAmountPaise: { type: Number, required: true, min: 1 },
    paidAmountPaise: { type: Number, required: true, default: 0, min: 0 },
    status: { type: String, enum: ['PLANNED', 'COMPLETED', 'CANCELLED'], default: 'PLANNED' },
    notes: { type: String, default: '' },
    items: {
      type: [
        new Schema(
          {
            name: { type: String, required: true, trim: true },
            categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
            estimatedAmountPaise: { type: Number, required: true, min: 1 },
          },
          { timestamps: true },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

plannedExpenseSchema.index({ userId: 1, status: 1, dueDate: 1 });

export type PlannedExpenseDocument = InferSchemaType<typeof plannedExpenseSchema> & {
  _id: Types.ObjectId;
};

export const PlannedExpenseModel = model('PlannedExpense', plannedExpenseSchema);
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const budgetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    notes: { type: String, default: '' },
    items: {
      type: [
        new Schema(
          {
            categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
            amountPaise: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

budgetSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });
budgetSchema.index({ userId: 1, year: 1, month: 1, 'items.categoryId': 1 });

export type BudgetDocument = InferSchemaType<typeof budgetSchema> & {
  _id: Types.ObjectId;
};

export const MonthlyBudgetModel = model('MonthlyBudget', budgetSchema);

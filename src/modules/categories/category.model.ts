import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { CATEGORY_TYPES } from '../../shared/constants/index.js';

const categorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: CATEGORY_TYPES, required: true },
    icon: { type: String, default: 'circle' },
    color: { type: String, default: '#64748B' },
    isDefault: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

categorySchema.index({ userId: 1, name: 1, type: 1 }, { unique: true });
categorySchema.index({ userId: 1, type: 1, isArchived: 1 });

export type CategoryDocument = InferSchemaType<typeof categorySchema> & {
  _id: Types.ObjectId;
};

export const CategoryModel = model('Category', categorySchema);

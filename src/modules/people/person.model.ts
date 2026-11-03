import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const personSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    notes: { type: String, default: '' },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

personSchema.index({ userId: 1, name: 1 });

export type PersonDocument = InferSchemaType<typeof personSchema> & {
  _id: Types.ObjectId;
};

export const PersonModel = model('Person', personSchema);

import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ACCOUNT_TYPES } from '../../shared/constants/index.js';

const accountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    institutionName: { type: String, trim: true, default: '' },
    maskedIdentifier: { type: String, trim: true, default: '' },
    openingBalancePaise: { type: Number, required: true, default: 0 },
    openingBalanceDate: { type: Date, required: true },
    currency: { type: String, default: 'INR' },
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

accountSchema.index({ userId: 1, name: 1 }, { unique: true });
accountSchema.index({ userId: 1, isArchived: 1 });

export type AccountDocument = InferSchemaType<typeof accountSchema> & {
  _id: Types.ObjectId;
};

export const AccountModel = model('Account', accountSchema);

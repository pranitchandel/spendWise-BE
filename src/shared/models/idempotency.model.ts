import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const idempotencySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    requestHash: { type: String, required: true },
    statusCode: { type: Number, required: true },
    responseBody: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

idempotencySchema.index({ userId: 1, key: 1 }, { unique: true });
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type IdempotencyDocument = InferSchemaType<typeof idempotencySchema> & {
  _id: Types.ObjectId;
};

export const IdempotencyModel = model('IdempotencyKey', idempotencySchema);

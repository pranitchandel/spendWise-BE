import mongoose, { type ClientSession, Types } from 'mongoose';
import { ValidationError } from '../errors/AppError.js';

export function toObjectId(id: string, label = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new ValidationError(`Invalid ${label}`);
  }
  return new Types.ObjectId(id);
}

export function isObjectIdString(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

/** Run work in a MongoDB transaction when a replica set is available. */
export async function withTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

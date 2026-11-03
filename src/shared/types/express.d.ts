import type { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
      idempotencyKey?: string;
    }
  }
}

export type ObjectId = Types.ObjectId;

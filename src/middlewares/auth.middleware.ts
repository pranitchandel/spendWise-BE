import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../shared/errors/AppError.js';

interface AccessTokenPayload {
  userId: string;
  email: string;
  type: 'access';
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid authorization header'));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    if (payload.type !== 'access') {
      return next(new UnauthorizedError('Invalid token type'));
    }
    req.user = { userId: payload.userId, email: payload.email };
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey === 'string' && idempotencyKey.length > 0) {
      req.idempotencyKey = idempotencyKey;
    }
    return next();
  } catch {
    return next(new UnauthorizedError('Invalid or expired access token'));
  }
}

import type { NextFunction, Request, Response } from 'express';
import { IdempotencyConflictError } from '../errors/AppError.js';
import { IdempotencyModel } from '../models/idempotency.model.js';
import { sha256 } from './tokens.js';
import { toObjectId } from './mongo.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.idempotencyKey;
  if (!key || !req.user) return next();

  const userId = req.user.userId;
  const requestHash = sha256(
    JSON.stringify({ method: req.method, path: req.originalUrl, body: req.body }),
  );

  void (async () => {
    const existing = await IdempotencyModel.findOne({
      userId: toObjectId(userId, 'userId'),
      key,
    }).lean();

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return next(new IdempotencyConflictError());
      }
      return res.status(existing.statusCode).json(existing.responseBody);
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const statusCode = res.statusCode || 200;
      void IdempotencyModel.findOneAndUpdate(
        { userId: toObjectId(userId, 'userId'), key },
        {
          userId: toObjectId(userId, 'userId'),
          key,
          method: req.method,
          path: req.originalUrl,
          requestHash,
          statusCode,
          responseBody: body,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
        { upsert: true, setDefaultsOnInsert: true },
      ).catch(() => undefined);
      return originalJson(body);
    }) as Response['json'];

    return next();
  })().catch(next);
}

import type { NextFunction, Request, Response } from 'express';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import * as service from './transaction.service.js';
import type { ListTransactionsQuery } from './transaction.types.js';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.createTransaction(
      req.user!.userId,
      req.body,
      req.idempotencyKey,
    );
    return sendCreated(res, data);
  } catch (err) {
    return next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.listTransactions(
      req.user!.userId,
      res.locals.validatedQuery as ListTransactionsQuery,
    );
    return sendSuccess(res, result.items, 200, { pagination: result.pagination });
  } catch (err) {
    return next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.getTransaction(req.user!.userId, req.params.id as string);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.updateTransaction(
      req.user!.userId,
      req.params.id as string,
      req.body,
    );
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.deleteTransaction(req.user!.userId, req.params.id as string);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
}

export async function daily(req: Request, res: Response, next: NextFunction) {
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const data = await service.getDailySummary(req.user!.userId, date);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
}

export async function monthly(req: Request, res: Response, next: NextFunction) {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const data = await service.getMonthlySummary(req.user!.userId, year, month);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
}

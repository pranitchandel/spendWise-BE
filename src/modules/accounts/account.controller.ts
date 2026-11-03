import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import { accountService } from './account.service.js';

function uid(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user.userId;
}

export const accountController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = res.locals.validatedQuery as { includeArchived?: boolean };
      const data = await accountService.list(uid(req), query.includeArchived ?? false);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await accountService.create(uid(req), req.body);
      return sendCreated(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await accountService.getById(uid(req), req.params.id as string);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await accountService.update(uid(req), req.params.id as string, req.body);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await accountService.remove(uid(req), req.params.id as string);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async permanentlyDelete(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await accountService.permanentlyDelete(uid(req), req.params.id as string);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async balance(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await accountService.getBalance(uid(req), req.params.id as string);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async transactions(req: Request, res: Response, next: NextFunction) {
    try {
      const query = res.locals.validatedQuery as {
        page: number;
        limit: number;
        from?: string;
        to?: string;
      };
      const result = await accountService.listTransactions(uid(req), req.params.id as string, query);
      return sendSuccess(res, result.items, 200, result.meta);
    } catch (err) {
      return next(err);
    }
  },
};

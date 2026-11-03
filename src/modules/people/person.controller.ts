import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import { personService } from './person.service.js';

function uid(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user.userId;
}

export const personController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await personService.list(uid(req), {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        q: req.query.q as string | undefined,
        includeArchived: Boolean(req.query.includeArchived),
      });
      return sendSuccess(res, result.items, 200, result.meta);
    } catch (err) {
      return next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await personService.create(uid(req), req.body);
      return sendCreated(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await personService.getById(uid(req), req.params.id as string);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await personService.update(uid(req), req.params.id as string, req.body);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await personService.remove(uid(req), req.params.id as string);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },
};

import type { NextFunction, Request, Response } from 'express';
import type { CategoryType } from '../../shared/constants/index.js';
import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import { categoryService } from './category.service.js';

function uid(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user.userId;
}

export const categoryController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = res.locals.validatedQuery as {
        type?: CategoryType;
        includeArchived?: boolean;
      };
      const data = await categoryService.list(uid(req), query);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await categoryService.create(uid(req), req.body);
      return sendCreated(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await categoryService.update(uid(req), req.params.id as string, req.body);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await categoryService.remove(uid(req), req.params.id as string);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },
};

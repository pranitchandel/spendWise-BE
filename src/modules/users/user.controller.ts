import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { userService } from './user.service.js';

function requireUser(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export const userController = {
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const data = await userService.getMe(user.userId);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const data = await userService.updateMe(user.userId, req.body);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },
};

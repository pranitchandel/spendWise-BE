import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import { authService } from './auth.service.js';

const REFRESH_COOKIE = 'refreshToken';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

function meta(req: Request) {
  return {
    userAgent: req.get('user-agent') ?? null,
    ip: req.ip ?? null,
  };
}

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(req.body, meta(req));
      setRefreshCookie(res, result.refreshToken);
      return sendCreated(res, result);
    } catch (err) {
      return next(err);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(req.body, meta(req));
      setRefreshCookie(res, result.refreshToken);
      return sendSuccess(res, result);
    } catch (err) {
      return next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token =
        (req.body?.refreshToken as string | undefined) ||
        (req.cookies?.[REFRESH_COOKIE] as string | undefined);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Refresh token required' },
        });
      }
      const result = await authService.refresh(token, meta(req));
      setRefreshCookie(res, result.refreshToken);
      return sendSuccess(res, result);
    } catch (err) {
      return next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token =
        (req.body?.refreshToken as string | undefined) ||
        (req.cookies?.[REFRESH_COOKIE] as string | undefined);
      await authService.logout(token);
      clearRefreshCookie(res);
      return sendSuccess(res, { loggedOut: true });
    } catch (err) {
      return next(err);
    }
  },
};

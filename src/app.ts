import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { accountRoutes } from './modules/accounts/account.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { borrowingRouter } from './modules/borrowing/borrowing.routes.js';
import { budgetRouter } from './modules/budgets/budget.routes.js';
import { categoryRoutes } from './modules/categories/category.routes.js';
import { lendingRouter } from './modules/lending/lending.routes.js';
import { plannedExpenseRouter } from './modules/planned-expenses/planned-expense.routes.js';
import { recurringRouter } from './modules/recurring/recurring.routes.js';
import { transactionRouter } from './modules/transactions/transaction.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { NotFoundError } from './shared/errors/AppError.js';
import { logger } from './shared/utils/logger.js';

export function createApp() {
  const app = express();
  const allowedOrigins = new Set(env.CORS_ORIGIN.split(',').map((origin) => origin.trim()));

  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  const healthCheck = (_req: express.Request, res: express.Response) => {
    const databaseConnected = mongoose.connection.readyState === 1;
    return res.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? 'ok' : 'unavailable',
      database: databaseConnected ? 'connected' : 'disconnected',
    });
  };

  app.get('/health', healthCheck);
  app.get('/api/v1/health', healthCheck);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/accounts', accountRoutes);
  app.use('/api/v1/categories', categoryRoutes);
  app.use('/api/v1/transactions', transactionRouter);
  app.use('/api/v1/budgets', budgetRouter);
  app.use('/api/v1/lending', lendingRouter);
  app.use('/api/v1/borrowing', borrowingRouter);
  app.use('/api/v1/planned-expenses', plannedExpenseRouter);
  app.use('/api/v1/recurring', recurringRouter);
  app.use('/api/v1/users', userRoutes);

  app.use((_req, _res, next) => next(new NotFoundError('Route')));
  app.use(errorMiddleware);

  return app;
}
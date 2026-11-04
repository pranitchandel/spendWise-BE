import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { PAYMENT_MODES } from '../../shared/constants/index.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import { createTransactionSchema } from '../transactions/transaction.types.js';
import * as service from './lending.service.js';

export const lendingRouter = Router();
lendingRouter.use(authMiddleware);

lendingRouter.get('/', async (req, res, next) => {
  try {
    const data = await service.listLending(req.user!.userId, req.query.status as string);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

lendingRouter.get('/dashboard', async (req, res, next) => {
  try {
    const data = await service.lendingDashboard(req.user!.userId);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

lendingRouter.post('/', validate(createTransactionSchema), async (req, res, next) => {
  try {
    const data = await service.createLending(req.user!.userId, {
      ...req.body,
      personName: req.body.personName ?? 'Unknown',
    });
    return sendCreated(res, data);
  } catch (err) {
    return next(err);
  }
});

lendingRouter.put('/:id', validate(z.object({
  personName: z.string().trim().min(1).max(120),
  phone: z.string().max(40).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  amount: z.number().positive(),
  transactionDate: z.string().min(1),
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  paymentMode: z.enum(PAYMENT_MODES),
  expectedRepaymentDate: z.string().nullable().optional(),
  interestRate: z.number().min(0).nullable().optional(),
  description: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
})), async (req, res, next) => {
  try {
    const data = await service.updateLending(req.user!.userId, req.params.id as string, req.body);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

lendingRouter.delete('/:id', async (req, res, next) => {
  try {
    const data = await service.deleteLending(req.user!.userId, req.params.id as string);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

lendingRouter.get('/:id', async (req, res, next) => {
  try {
    const data = await service.getLending(req.user!.userId, req.params.id as string);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

lendingRouter.post(
  '/:id/repayments',
  validate(
    z.object({
      amount: z.number().positive(),
      interestAmount: z.number().min(0).optional(),
      accountId: z.string().min(1),
      categoryId: z.string().min(1),
      paymentMode: z.enum(PAYMENT_MODES),
      transactionDate: z.string().min(1),
      note: z.string().optional(),
      idempotencyKey: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const data = await service.addRepayment(
        req.user!.userId,
        req.params.id as string,
        req.body,
      );
      return sendCreated(res, data);
    } catch (err) {
      return next(err);
    }
  },
);

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { PAYMENT_MODES } from '../../shared/constants/index.js';
import { paginationSchema } from '../../shared/schemas/common.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import * as service from './planned-income.service.js';

export const plannedIncomeRouter = Router();
plannedIncomeRouter.use(authMiddleware);

const incomeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.number().positive(),
  accountId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  frequency: z.enum(['ONCE', 'MONTHLY']),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  notes: z.string().max(2000).optional(),
});

plannedIncomeRouter.get('/', validate(paginationSchema.extend({ status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional() }), 'query'), async (req, res, next) => {
  try { return sendSuccess(res, await service.listPlannedIncomes(req.user!.userId, res.locals.validatedQuery)); }
  catch (error) { return next(error); }
});

plannedIncomeRouter.post('/', validate(incomeSchema), async (req, res, next) => {
  try { return sendCreated(res, await service.createPlannedIncome(req.user!.userId, req.body)); }
  catch (error) { return next(error); }
});

plannedIncomeRouter.put('/:id', validate(incomeSchema.partial()), async (req, res, next) => {
  try { return sendSuccess(res, await service.updatePlannedIncome(req.user!.userId, req.params.id as string, req.body)); }
  catch (error) { return next(error); }
});

plannedIncomeRouter.delete('/:id', async (req, res, next) => {
  try { return sendSuccess(res, await service.deletePlannedIncome(req.user!.userId, req.params.id as string)); }
  catch (error) { return next(error); }
});

plannedIncomeRouter.post('/:id/actuals', validate(z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  actualDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  paymentMode: z.enum(PAYMENT_MODES),
  categoryId: z.string().min(1),
  note: z.string().max(2000).optional(),
})), async (req, res, next) => {
  try {
    return sendCreated(res, await service.recordPlannedIncome(
      req.user!.userId,
      req.params.id as string,
      req.body,
      req.idempotencyKey,
    ));
  } catch (error) { return next(error); }
});
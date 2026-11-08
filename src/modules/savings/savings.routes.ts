import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { PAYMENT_MODES } from '../../shared/constants/index.js';
import { paginationSchema } from '../../shared/schemas/common.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import { SAVINGS_COMPOUNDING_FREQUENCIES, SAVINGS_GOAL_STATUSES, SAVINGS_OPTION_TYPES } from './savings.model.js';
import * as service from './savings.service.js';

export const savingsRouter = Router();
savingsRouter.use(authMiddleware);

const allocationSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  optionType: z.enum(SAVINGS_OPTION_TYPES),
  expectedAnnualReturnRate: z.number().min(0).max(100),
  compoundingFrequency: z.enum(SAVINGS_COMPOUNDING_FREQUENCIES),
  monthlyContribution: z.number().min(0),
});

const goalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetAmount: z.number().positive(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).optional(),
  allocations: z.array(allocationSchema).min(1),
  status: z.enum(SAVINGS_GOAL_STATUSES).optional(),
});

savingsRouter.get('/', validate(paginationSchema.extend({ status: z.enum(SAVINGS_GOAL_STATUSES).optional() }), 'query'), async (req, res, next) => {
  try {
    return sendSuccess(res, await service.listSavingsGoals(req.user!.userId, res.locals.validatedQuery));
  } catch (error) {
    return next(error);
  }
});

savingsRouter.post('/', validate(goalSchema), async (req, res, next) => {
  try {
    return sendCreated(res, await service.createSavingsGoal(req.user!.userId, req.body));
  } catch (error) {
    return next(error);
  }
});

savingsRouter.put('/:id', validate(goalSchema.partial()), async (req, res, next) => {
  try {
    return sendSuccess(res, await service.updateSavingsGoal(req.user!.userId, req.params.id as string, req.body));
  } catch (error) {
    return next(error);
  }
});

savingsRouter.delete('/:id', async (req, res, next) => {
  try {
    return sendSuccess(res, await service.deleteSavingsGoal(req.user!.userId, req.params.id as string));
  } catch (error) {
    return next(error);
  }
});

savingsRouter.post('/:id/allocations/:allocationId/movements', validate(z.object({
  direction: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  amount: z.number().positive(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counterpartAccountId: z.string().min(1),
  paymentMode: z.enum(PAYMENT_MODES),
  categoryId: z.string().min(1),
  note: z.string().max(2000).optional(),
})), async (req, res, next) => {
  try {
    const data = await service.recordSavingsMovement(
      req.user!.userId,
      req.params.id as string,
      req.params.allocationId as string,
      req.body,
      req.idempotencyKey,
    );
    return sendCreated(res, data);
  } catch (error) {
    return next(error);
  }
});
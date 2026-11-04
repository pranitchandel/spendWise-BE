import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { PAYMENT_MODES } from '../../shared/constants/index.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import * as service from './planned-expense.service.js';

export const plannedExpenseRouter = Router();
plannedExpenseRouter.use(authMiddleware);

const campaignItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  categoryId: z.string().min(1),
  estimatedAmount: z.number().positive(),
});

const plannedExpenseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dueDate: z.string().min(1).nullable().optional(),
  items: z.array(campaignItemSchema).min(1),
  status: z.enum(['PLANNED', 'COMPLETED', 'CANCELLED']).optional(),
  notes: z.string().max(2000).optional(),
});

plannedExpenseRouter.get('/', async (req, res, next) => {
  try {
    return sendSuccess(res, await service.listPlannedExpenses(req.user!.userId));
  } catch (error) {
    return next(error);
  }
});

plannedExpenseRouter.post('/', validate(plannedExpenseSchema), async (req, res, next) => {
  try {
    return sendCreated(res, await service.createPlannedExpense(req.user!.userId, req.body));
  } catch (error) {
    return next(error);
  }
});

plannedExpenseRouter.put('/:id', validate(plannedExpenseSchema.partial()), async (req, res, next) => {
  try {
    return sendSuccess(res, await service.updatePlannedExpense(req.user!.userId, req.params.id as string, req.body));
  } catch (error) {
    return next(error);
  }
});

plannedExpenseRouter.delete('/:id', async (req, res, next) => {
  try {
    return sendSuccess(res, await service.deletePlannedExpense(req.user!.userId, req.params.id as string));
  } catch (error) {
    return next(error);
  }
});

plannedExpenseRouter.post('/:id/spend', validate(z.object({
  itemId: z.string().min(1),
  amount: z.number().positive(),
  transactionDate: z.string().min(1),
  accountId: z.string().min(1),
  paymentMode: z.enum(PAYMENT_MODES),
  note: z.string().max(2000).optional(),
  categoryId: z.string().min(1).optional(),
})), async (req, res, next) => {
  try {
    const data = await service.recordCampaignSpend(
      req.user!.userId,
      req.params.id as string,
      req.body,
      req.idempotencyKey,
    );
    return sendCreated(res, data);
  } catch (error) {
    return next(error);
  }
});
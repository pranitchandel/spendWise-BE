import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { paginationSchema } from '../../shared/schemas/common.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import * as service from './budget.service.js';

export const budgetRouter = Router();
budgetRouter.use(authMiddleware);

const itemSchema = z.object({
  categoryId: z.string().min(1),
  amount: z.number().min(0),
});

budgetRouter.get('/', validate(paginationSchema.extend({ year: z.coerce.number().int().min(2000).optional() }), 'query'), async (req, res, next) => {
  try {
    const data = await service.listBudgets(req.user!.userId, res.locals.validatedQuery);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

budgetRouter.get('/:year/:month/actuals', async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const data = await service.getMonthlySpendingByCategory(req.user!.userId, year, month);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

budgetRouter.get('/:year/:month', async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const data = await service.getBudget(req.user!.userId, year, month);
    return sendSuccess(res, data);
  } catch (err) {
    return next(err);
  }
});

budgetRouter.post(
  '/',
  validate(
    z.object({
      year: z.number().int().min(2000),
      month: z.number().int().min(1).max(12),
      items: z.array(itemSchema).min(1),
      notes: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const data = await service.createBudget(req.user!.userId, req.body);
      return sendCreated(res, data);
    } catch (err) {
      return next(err);
    }
  },
);

budgetRouter.put(
  '/:id',
  validate(
    z.object({
      items: z.array(itemSchema).optional(),
      notes: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const data = await service.updateBudget(
        req.user!.userId,
        req.params.id as string,
        req.body,
      );
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },
);

budgetRouter.post(
  '/copy',
  validate(
    z.object({
      fromYear: z.number().int(),
      fromMonth: z.number().int().min(1).max(12),
      toYear: z.number().int(),
      toMonth: z.number().int().min(1).max(12),
      overwrite: z.boolean().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const data = await service.copyBudget(req.user!.userId, req.body);
      return sendSuccess(res, data);
    } catch (err) {
      return next(err);
    }
  },
);

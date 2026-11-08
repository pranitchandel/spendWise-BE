import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { PAYMENT_MODES, RECURRING_FREQUENCIES } from '../../shared/constants/index.js';
import { paginationSchema } from '../../shared/schemas/common.js';
import { sendCreated, sendSuccess } from '../../shared/utils/api-response.js';
import * as service from './recurring.service.js';

export const recurringRouter = Router();
recurringRouter.use(authMiddleware);

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['EXPENSE', 'INCOME', 'TRANSFER']),
  amount: z.number().positive(),
  frequency: z.enum(RECURRING_FREQUENCIES),
  categoryId: z.string().min(1),
  accountId: z.string().min(1),
  toAccountId: z.string().optional().nullable(),
  paymentMode: z.enum(PAYMENT_MODES),
  description: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  startDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
});

recurringRouter.get('/', validate(paginationSchema.extend({
  includeInactive: z.union([z.literal('true'), z.literal('false')]).optional().transform((value) => value === 'true'),
}), 'query'), async (req, res, next) => {
  try {
    return sendSuccess(res, await service.listRecurring(req.user!.userId, res.locals.validatedQuery));
  } catch (error) {
    return next(error);
  }
});

recurringRouter.post('/generate', validate(z.object({ through: z.string().min(1) })), async (req, res, next) => {
  try {
    return sendSuccess(res, await service.generateOccurrences(req.user!.userId, req.body.through));
  } catch (error) {
    return next(error);
  }
});

recurringRouter.post('/', validate(ruleSchema), async (req, res, next) => {
  try {
    return sendCreated(res, await service.createRecurring(req.user!.userId, req.body));
  } catch (error) {
    return next(error);
  }
});

recurringRouter.put('/:id', validate(ruleSchema.partial().extend({ isActive: z.boolean().optional() })), async (req, res, next) => {
  try {
    return sendSuccess(res, await service.updateRecurring(req.user!.userId, req.params.id as string, req.body));
  } catch (error) {
    return next(error);
  }
});

recurringRouter.delete('/:id', async (req, res, next) => {
  try {
    return sendSuccess(res, await service.deleteRecurring(req.user!.userId, req.params.id as string));
  } catch (error) {
    return next(error);
  }
});

recurringRouter.post('/:id/occurrences/:occurrenceId/mark-paid', validate(z.object({
  action: z.enum(['PAID', 'SKIPPED', 'POSTPONED']).default('PAID'),
  accountId: z.string().optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  postponedTo: z.string().optional(),
  note: z.string().max(2000).optional(),
})), async (req, res, next) => {
  try {
    const data = await service.updateOccurrence(
      req.user!.userId,
      req.params.id as string,
      req.params.occurrenceId as string,
      req.body,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return next(error);
  }
});
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import * as controller from './transaction.controller.js';
import {
  createTransactionSchema,
  listTransactionsSchema,
  updateTransactionSchema,
} from './transaction.types.js';

export const transactionRouter = Router();

transactionRouter.use(authMiddleware);

transactionRouter.get('/', validate(listTransactionsSchema, 'query'), controller.list);
transactionRouter.post('/', validate(createTransactionSchema), controller.create);
transactionRouter.get('/summary/daily', controller.daily);
transactionRouter.get(
  '/summary/monthly',
  validate(
    z.object({
      year: z.coerce.number().int().min(2000),
      month: z.coerce.number().int().min(1).max(12),
    }),
    'query',
  ),
  controller.monthly,
);
transactionRouter.get('/:id', controller.getById);
transactionRouter.put('/:id', validate(updateTransactionSchema), controller.update);
transactionRouter.delete('/:id', controller.remove);

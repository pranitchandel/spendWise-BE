import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { idempotencyMiddleware } from '../../shared/utils/idempotency.js';
import { accountController } from './account.controller.js';
import {
  accountIdParamsSchema,
  accountTransactionsQuerySchema,
  createAccountSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
} from './account.types.js';

export const accountRoutes = Router();

accountRoutes.use(authMiddleware);
accountRoutes.get('/', validate(listAccountsQuerySchema, 'query'), accountController.list);
accountRoutes.post('/', idempotencyMiddleware, validate(createAccountSchema), accountController.create);
accountRoutes.get('/:id', validate(accountIdParamsSchema, 'params'), accountController.getById);
accountRoutes.put(
  '/:id',
  validate(accountIdParamsSchema, 'params'),
  validate(updateAccountSchema),
  accountController.update,
);
accountRoutes.delete(
  '/:id/permanent',
  validate(accountIdParamsSchema, 'params'),
  accountController.permanentlyDelete,
);
accountRoutes.delete(
  '/:id',
  validate(accountIdParamsSchema, 'params'),
  accountController.remove,
);
accountRoutes.get(
  '/:id/balance',
  validate(accountIdParamsSchema, 'params'),
  accountController.balance,
);
accountRoutes.get(
  '/:id/transactions',
  validate(accountIdParamsSchema, 'params'),
  validate(accountTransactionsQuerySchema, 'query'),
  accountController.transactions,
);

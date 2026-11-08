import { z } from 'zod';
import { TRANSACTION_TYPES } from '../../shared/constants/index.js';
import { objectIdSchema } from '../../shared/schemas/common.js';
import { ACTIVITY_ACTIONS, ACTIVITY_SOURCES } from './activity-log.model.js';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const listActivityLogsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.preprocess(emptyToUndefined, z.enum(ACTIVITY_ACTIONS).optional()),
  transactionType: z.preprocess(emptyToUndefined, z.enum(TRANSACTION_TYPES).optional()),
  source: z.preprocess(emptyToUndefined, z.enum(ACTIVITY_SOURCES).optional()),
  accountId: z.preprocess(emptyToUndefined, objectIdSchema.optional()),
  transactionId: z.preprocess(emptyToUndefined, objectIdSchema.optional()),
  from: z.preprocess(emptyToUndefined, z.string().optional()),
  to: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type ListActivityLogsQuery = z.infer<typeof listActivityLogsSchema>;

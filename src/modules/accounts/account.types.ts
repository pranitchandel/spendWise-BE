import { z } from 'zod';
import { ACCOUNT_TYPES } from '../../shared/constants/index.js';
import { moneyAmountSchema, objectIdSchema, paginationSchema } from '../../shared/schemas/common.js';

export const createAccountSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  type: z.enum(ACCOUNT_TYPES),
  institutionName: z.string().max(120).optional(),
  maskedIdentifier: z.string().max(40).optional(),
  openingBalance: z.union([z.number(), z.string()]).default(0),
  openingBalanceDate: z.string().optional(),
  currency: z.string().default('INR'),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  institutionName: z.string().max(120).optional(),
  maskedIdentifier: z.string().max(40).optional(),
  openingBalance: z.union([z.number(), z.string()]).optional(),
  openingBalanceDate: z.string().optional(),
  currency: z.string().min(3).max(3).optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export const accountIdParamsSchema = z.object({ id: objectIdSchema });

export const listAccountsQuerySchema = z.object({
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export const accountTransactionsQuerySchema = paginationSchema.extend({
  from: z.string().optional(),
  to: z.string().optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

// silence unused import if tree-shaken
void moneyAmountSchema;

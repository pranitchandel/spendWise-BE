import { z } from 'zod';
import { objectIdSchema, paginationSchema } from '../../shared/schemas/common.js';

export const createPersonSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().max(1000).optional(),
});

export const updatePersonSchema = createPersonSchema.partial().extend({
  isArchived: z.boolean().optional(),
});

export const personIdParamsSchema = z.object({ id: objectIdSchema });

export const listPeopleQuerySchema = paginationSchema.extend({
  q: z.string().optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

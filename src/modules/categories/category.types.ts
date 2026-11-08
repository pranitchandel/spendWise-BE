import { z } from 'zod';
import { CATEGORY_TYPES } from '../../shared/constants/index.js';
import { objectIdSchema, paginationSchema } from '../../shared/schemas/common.js';

export const createCategorySchema = z.object({
  name: z.string().min(1).max(80).trim(),
  type: z.enum(CATEGORY_TYPES),
  icon: z.string().min(1).max(40).optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  icon: z.string().min(1).max(40).optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional(),
  isArchived: z.boolean().optional(),
});

export const listCategoriesQuerySchema = z.object({
  type: z.enum(CATEGORY_TYPES).optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  page: paginationSchema.shape.page.optional(),
  limit: paginationSchema.shape.limit.optional(),
});

export const categoryIdParamsSchema = z.object({
  id: objectIdSchema,
});

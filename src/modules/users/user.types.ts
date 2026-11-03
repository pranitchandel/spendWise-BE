import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  preferredCurrency: z.string().min(3).max(3).optional(),
  timezone: z.string().min(1).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

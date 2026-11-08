import { z } from 'zod';

export const updateProfileSchema = z.object({
  email: z.string().email().toLowerCase().trim().optional(),
  name: z.string().min(1).max(120).trim().optional(),
  preferredCurrency: z.string().min(3).max(3).optional(),
  timezone: z.string().min(1).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

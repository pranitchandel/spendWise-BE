import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { userController } from './user.controller.js';
import { updateProfileSchema } from './user.types.js';

export const userRoutes = Router();

userRoutes.use(authMiddleware);
userRoutes.get('/me', userController.getMe);
userRoutes.put('/me', validate(updateProfileSchema), userController.updateMe);

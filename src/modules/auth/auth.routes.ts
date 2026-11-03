import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middlewares/validation.middleware.js';
import { authController } from './auth.controller.js';
import { loginSchema, refreshSchema, registerSchema } from './auth.types.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validate(registerSchema), authController.register);
authRoutes.post('/login', authLimiter, validate(loginSchema), authController.login);
authRoutes.post('/refresh', authLimiter, validate(refreshSchema), authController.refresh);
authRoutes.post('/logout', validate(refreshSchema), authController.logout);

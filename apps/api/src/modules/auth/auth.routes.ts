import { Router } from 'express';
import { authController } from './auth.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { loginSchema, refreshTokenSchema, registerUserSchema } from './auth.schema.js';

export const authRouter = Router();

// Public auth endpoints
authRouter.post('/login', validate(loginSchema), (req, res, next) => authController.login(req, res, next));
authRouter.post('/refresh', validate(refreshTokenSchema), (req, res, next) => authController.refresh(req, res, next));
authRouter.post('/logout', (req, res, next) => authController.logout(req, res, next));

// Authenticated current user endpoint
authRouter.get('/me', authenticate, (req, res, next) => authController.me(req, res, next));

// Admin user creation endpoint
authRouter.post(
  '/users',
  authenticate,
  requireRole('SUPER_ADMIN', 'ADMIN'),
  validate(registerUserSchema),
  (req, res, next) => authController.registerUser(req, res, next)
);

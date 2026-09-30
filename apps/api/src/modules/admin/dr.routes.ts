import { Router, Request, Response, NextFunction } from 'express';
import { disasterRecoveryService } from './dr.service.js';
import { deadLetterService } from './deadLetter.service.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

export const drRouter = Router();

// ==========================================
// 1. DISASTER RECOVERY DRILLS & RPO/RTO
// ==========================================
drRouter.post(
  '/dr/recovery-drills',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const drill = await disasterRecoveryService.createRecoveryDrill(req.body, req.user as any);
      res.status(201).json({ drill });
    } catch (err) { next(err); }
  }
);

drRouter.post(
  '/dr/recovery-drills/:id/execute',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const drill = await disasterRecoveryService.executeRecoveryDrill(req.params.id, req.user as any);
      res.json({ drill });
    } catch (err) { next(err); }
  }
);

drRouter.get(
  '/dr/status',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await disasterRecoveryService.getDrStatus(req.user as any);
      res.json({ disasterRecoveryStatus: status });
    } catch (err) { next(err); }
  }
);

// ==========================================
// 2. DEAD-LETTER MANAGEMENT
// ==========================================
drRouter.get(
  '/dead-letters',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deadLetterService.listDeadLetters(req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

drRouter.post(
  '/dead-letters/:id/retry',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deadLetterService.retryItem(req.body.type || 'OUTBOX', req.params.id, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

drRouter.post(
  '/dead-letters/:id/resolve',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deadLetterService.resolveItem(req.body.type || 'OUTBOX', req.params.id, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

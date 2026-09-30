import { Router, Request, Response, NextFunction } from 'express';
import { webhookService } from '../webhooks/webhook.service.js';
import { integrationService } from './integration.service.js';
import { automationService } from '../../automation/automation.service.js';
import { authenticate } from '../../../middleware/auth.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { validate } from '../../../middleware/validate.js';
import { createWebhookSchema } from '../webhooks/webhook.schema.js';
import { createAutomationRuleSchema } from '../../automation/automation.schema.js';

export const integrationRouter = Router();

// ==========================================
// 1. WEBHOOK SUBSYSTEM
// ==========================================
integrationRouter.post(
  '/webhooks',
  authenticate,
  requirePermission('admin:all'),
  validate(createWebhookSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await webhookService.createEndpoint(req.body, req.user as any);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

integrationRouter.get(
  '/webhooks',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const endpoints = await webhookService.listEndpoints(req.user as any);
      res.json({ endpoints });
    } catch (err) { next(err); }
  }
);

integrationRouter.post(
  '/webhooks/:id/rotate-secret',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await webhookService.rotateSecret(req.params.id, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

integrationRouter.delete(
  '/webhooks/:id',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await webhookService.deleteEndpoint(req.params.id, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// ==========================================
// 2. THIRD-PARTY INTEGRATIONS & CREDENTIALS
// ==========================================
integrationRouter.post(
  '/admin/integrations',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await integrationService.createIntegration(req.body, req.user as any);
      res.status(201).json({ integration: result });
    } catch (err) { next(err); }
  }
);

integrationRouter.get(
  '/admin/integrations',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const integrations = await integrationService.listIntegrations(req.user as any);
      res.json({ integrations });
    } catch (err) { next(err); }
  }
);

integrationRouter.post(
  '/admin/integrations/:id/rotate',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await integrationService.rotateCredential(req.params.id, req.body.secretPayload, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// ==========================================
// 3. AUTOMATION RULES
// ==========================================
integrationRouter.post(
  '/automation/rules',
  authenticate,
  requirePermission('admin:all'),
  validate(createAutomationRuleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rule = await automationService.createRule(req.body, req.user as any);
      res.status(201).json({ rule });
    } catch (err) { next(err); }
  }
);

integrationRouter.get(
  '/automation/rules',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rules = await automationService.listRules(req.user as any);
      res.json({ rules });
    } catch (err) { next(err); }
  }
);

integrationRouter.post(
  '/automation/rules/simulate',
  authenticate,
  requirePermission('admin:all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await automationService.simulateDryRun(req.body.rule, req.body.payload);
      res.json({ simulation: result });
    } catch (err) { next(err); }
  }
);

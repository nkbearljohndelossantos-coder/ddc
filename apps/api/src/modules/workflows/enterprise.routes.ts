import { Request, Response, NextFunction, Router } from 'express';
import { workflowService } from './workflow.service.js';
import { versioningService } from '../versioning/versioning.service.js';
import { advancedSearchService } from '../search/advancedSearch.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { bulkService } from '../bulk/bulk.service.js';
import { reportService } from '../reports/report.service.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { createVersionSchema, restoreVersionSchema } from '../versioning/versioning.schema.js';
import { advancedSearchSchema, createSavedSearchSchema } from '../search/advancedSearch.schema.js';
import {
  startWorkflowSchema,
  transitionWorkflowSchema,
  completeTaskSchema,
  reassignTaskSchema,
} from './workflow.schema.js';
import { bulkOperationSchema } from '../bulk/bulk.schema.js';

export const enterpriseRouter = Router();

// ==========================================
// 1. DOCUMENT VERSIONING
// ==========================================
enterpriseRouter.post(
  '/documents/:id/versions',
  authenticate,
  requirePermission('documents:write'),
  validate(createVersionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const version = await versioningService.createVersion(req.params.id, req.body, req.user as any);
      res.status(201).json({ version });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.get(
  '/documents/:id/versions',
  authenticate,
  requirePermission('documents:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const versions = await versioningService.listVersions(req.params.id, req.user as any);
      res.json({ versions });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.post(
  '/documents/:id/restore-version',
  authenticate,
  requirePermission('documents:write'),
  validate(restoreVersionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const version = await versioningService.restoreVersion(req.params.id, req.body, req.user as any);
      res.json({ restoredVersion: version });
    } catch (err) { next(err); }
  }
);

// ==========================================
// 2. ADVANCED & SAVED SEARCH
// ==========================================
enterpriseRouter.post(
  '/search/advanced',
  authenticate,
  requirePermission('documents:read'),
  validate(advancedSearchSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await advancedSearchService.advancedSearch(req.body, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

enterpriseRouter.post(
  '/search/saved',
  authenticate,
  requirePermission('documents:read'),
  validate(createSavedSearchSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const saved = await advancedSearchService.createSavedSearch(req.body, req.user as any);
      res.status(201).json({ savedSearch: saved });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.get(
  '/search/saved',
  authenticate,
  requirePermission('documents:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const searches = await advancedSearchService.listSavedSearches(req.user as any);
      res.json({ savedSearches: searches });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.get(
  '/search/saved/:id/execute',
  authenticate,
  requirePermission('documents:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await advancedSearchService.executeSavedSearch(req.params.id, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

enterpriseRouter.delete(
  '/search/saved/:id',
  authenticate,
  requirePermission('documents:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await advancedSearchService.deleteSavedSearch(req.params.id, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// ==========================================
// 3. WORKFLOWS & TASKS
// ==========================================
enterpriseRouter.post(
  '/workflows',
  authenticate,
  requirePermission('documents:write'),
  validate(startWorkflowSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.body;
      const wf = await workflowService.startWorkflow(documentId, req.body, req.user as any);
      res.status(201).json({ workflowInstance: wf });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.post(
  '/workflows/:id/transition',
  authenticate,
  requirePermission('documents:write'),
  validate(transitionWorkflowSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wf = await workflowService.transitionWorkflow(req.params.id, req.body, req.user as any);
      res.json({ workflowInstance: wf });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.post(
  '/tasks/:id/claim',
  authenticate,
  requirePermission('documents:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await workflowService.claimTask(req.params.id, req.user as any);
      res.json({ task });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.post(
  '/tasks/:id/complete',
  authenticate,
  requirePermission('documents:write'),
  validate(completeTaskSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await workflowService.completeTask(req.params.id, req.body, req.user as any);
      res.json({ task });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.post(
  '/tasks/:id/reassign',
  authenticate,
  requirePermission('documents:write'),
  validate(reassignTaskSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await workflowService.reassignTask(req.params.id, req.body, req.user as any);
      res.json({ task });
    } catch (err) { next(err); }
  }
);

// ==========================================
// 4. NOTIFICATIONS
// ==========================================
enterpriseRouter.get(
  '/notifications',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const notifications = await notificationService.getUserNotifications(req.user as any);
      res.json({ notifications });
    } catch (err) { next(err); }
  }
);

enterpriseRouter.post(
  '/notifications/:id/read',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const notification = await notificationService.markAsRead(req.params.id, req.user as any);
      res.json({ notification });
    } catch (err) { next(err); }
  }
);

// ==========================================
// 5. BULK OPERATIONS & ENTERPRISE REPORTS
// ==========================================
enterpriseRouter.post(
  '/bulk',
  authenticate,
  requirePermission('documents:write'),
  validate(bulkOperationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await bulkService.executeBulkOperation(req.body, req.user as any);
      res.json(result);
    } catch (err) { next(err); }
  }
);

enterpriseRouter.get(
  '/admin/reports',
  authenticate,
  requirePermission('admin:all', 'audit:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await reportService.getEnterpriseReport(req.user as any);
      res.json({ report });
    } catch (err) { next(err); }
  }
);

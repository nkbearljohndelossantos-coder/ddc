import { Router } from 'express';
import { jobController } from './job.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { authenticateAgent } from '../../middleware/agentAuth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  createScanJobSchema,
  acknowledgeJobSchema,
  updateJobStatusSchema,
  cancelJobSchema,
} from './job.schema.js';

export const jobRouter = Router();

// 1. User & Operator Endpoints
jobRouter.post(
  '/',
  authenticate,
  requirePermission('scan:execute'),
  validate(createScanJobSchema),
  (req, res, next) => jobController.createJob(req, res, next)
);

jobRouter.get(
  '/',
  authenticate,
  requirePermission('scan:execute', 'scanners:manage', 'documents:read'),
  (req, res, next) => jobController.listJobs(req, res, next)
);

jobRouter.get(
  '/:id',
  authenticate,
  requirePermission('scan:execute', 'scanners:manage', 'documents:read'),
  (req, res, next) => jobController.getJob(req, res, next)
);

jobRouter.post(
  '/:id/cancel',
  authenticate,
  requirePermission('scan:execute'),
  validate(cancelJobSchema),
  (req, res, next) => jobController.cancelJob(req, res, next)
);

// 2. Edge Agent Endpoints
jobRouter.post(
  '/ack',
  authenticateAgent,
  validate(acknowledgeJobSchema),
  (req, res, next) => jobController.acknowledgeJob(req, res, next)
);

jobRouter.post(
  '/:id/status',
  authenticateAgent,
  validate(updateJobStatusSchema),
  (req, res, next) => jobController.updateStatus(req, res, next)
);

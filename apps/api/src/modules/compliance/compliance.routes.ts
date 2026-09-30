import { Router } from 'express';
import { complianceController } from './compliance.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import {
  createRetentionPolicySchema,
  updateRetentionPolicySchema,
  deleteDocumentSchema,
  purgeDocumentSchema,
  auditQuerySchema,
} from './compliance.schema.js';

export const complianceRouter = Router();

// Retention Policies
complianceRouter.get(
  '/retention/policies',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => complianceController.getPolicies(req, res, next)
);

complianceRouter.post(
  '/retention/policies',
  authenticate,
  requirePermission('admin:all'),
  validate(createRetentionPolicySchema),
  (req, res, next) => complianceController.createPolicy(req, res, next)
);

complianceRouter.put(
  '/retention/policies/:id',
  authenticate,
  requirePermission('admin:all'),
  validate(updateRetentionPolicySchema),
  (req, res, next) => complianceController.updatePolicy(req, res, next)
);

// Assign Policy to Document
complianceRouter.post(
  '/documents/:id/assign-policy',
  authenticate,
  requirePermission('documents:write'),
  (req, res, next) => complianceController.assignPolicy(req, res, next)
);

// Controlled Deletion
complianceRouter.post(
  '/documents/:id/delete',
  authenticate,
  requirePermission('documents:write'),
  validate(deleteDocumentSchema),
  (req, res, next) => complianceController.deleteDocument(req, res, next)
);

// Permanent Purge (Admin Only)
complianceRouter.post(
  '/documents/:id/purge',
  authenticate,
  requirePermission('admin:all'),
  validate(purgeDocumentSchema),
  (req, res, next) => complianceController.purgeDocument(req, res, next)
);

// Query Audit Logs
complianceRouter.get(
  '/audit',
  authenticate,
  requirePermission('audit:read'),
  validate(auditQuerySchema, 'query'),
  (req, res, next) => complianceController.queryAudit(req, res, next)
);

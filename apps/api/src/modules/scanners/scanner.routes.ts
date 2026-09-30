import { Router } from 'express';
import { scannerController } from './scanner.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

export const scannerRouter = Router();

// All scanner endpoints require user authentication and proper permissions
scannerRouter.use(authenticate);

scannerRouter.get(
  '/',
  requirePermission('scanners:manage', 'scan:execute', 'documents:read'),
  (req, res, next) => scannerController.listScanners(req, res, next)
);

scannerRouter.get(
  '/:id',
  requirePermission('scanners:manage', 'scan:execute', 'documents:read'),
  (req, res, next) => scannerController.getScanner(req, res, next)
);

scannerRouter.get(
  '/:id/capabilities',
  requirePermission('scanners:manage', 'scan:execute'),
  (req, res, next) => scannerController.getScannerCapabilities(req, res, next)
);

scannerRouter.get(
  '/:id/status',
  requirePermission('scanners:manage', 'scan:execute', 'documents:read'),
  (req, res, next) => scannerController.getScannerStatus(req, res, next)
);

import { Router } from 'express';
import { scannerController } from './scanner.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

export const scannerRouter = Router();

// All scanner endpoints require user authentication and proper permissions
scannerRouter.use(authenticate);

// Universal Port Discovery & Local Storage Path Management
scannerRouter.get(
  '/ports',
  requirePermission('scanners:manage', 'scan:execute', 'documents:read'),
  (req, res, next) => scannerController.detectPorts(req, res, next)
);

scannerRouter.post(
  '/switch',
  requirePermission('scanners:manage', 'scan:execute', 'documents:write'),
  (req, res, next) => scannerController.switchScanner(req, res, next)
);

// Trigger Physical / Universal Scan & Dual-Save to Local + Cloud Storage
scannerRouter.post(
  '/scan',
  requirePermission('scanners:manage', 'scan:execute', 'documents:write'),
  (req, res, next) => scannerController.triggerScan(req, res, next)
);

scannerRouter.get(
  '/local-storage',
  requirePermission('scanners:manage', 'scan:execute', 'documents:read'),
  (req, res, next) => scannerController.getLocalStorage(req, res, next)
);

scannerRouter.post(
  '/local-storage',
  requirePermission('scanners:manage', 'scan:execute', 'documents:write'),
  (req, res, next) => scannerController.redirectLocalStorage(req, res, next)
);

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


import { Router } from 'express';
import { scannerController } from './scanner.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requireAnyPermission } from '../../middleware/rbac.js';

export const scannerRouter = Router();

// All scanner endpoints require user authentication and proper permissions
scannerRouter.use(authenticate);

// Universal Port Discovery & Local Storage Path Management
scannerRouter.get(
  '/ports',
  requireAnyPermission('documents:read', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.detectPorts(req, res, next)
);

scannerRouter.post(
  '/switch',
  requireAnyPermission('documents:write', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.switchScanner(req, res, next)
);

// Trigger Physical / Universal Scan & Dual-Save to Local + Cloud Storage
scannerRouter.post(
  '/scan',
  requireAnyPermission('documents:write', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.triggerScan(req, res, next)
);

scannerRouter.get(
  '/local-storage',
  requireAnyPermission('documents:read', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.getLocalStorage(req, res, next)
);

scannerRouter.post(
  '/local-storage',
  requireAnyPermission('documents:write', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.redirectLocalStorage(req, res, next)
);

scannerRouter.get(
  '/',
  requireAnyPermission('documents:read', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.listScanners(req, res, next)
);

scannerRouter.get(
  '/:id',
  requireAnyPermission('documents:read', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.getScanner(req, res, next)
);

scannerRouter.get(
  '/:id/capabilities',
  requireAnyPermission('documents:read', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.getScannerCapabilities(req, res, next)
);

scannerRouter.get(
  '/:id/status',
  requireAnyPermission('documents:read', 'scan:execute', 'scanners:manage'),
  (req, res, next) => scannerController.getScannerStatus(req, res, next)
);


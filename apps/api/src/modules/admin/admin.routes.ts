import { Router } from 'express';
import { adminController } from './admin.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import {
  createOrganizationSchema,
  createDepartmentSchema,
  createUserAdminSchema,
  updateUserAdminSchema,
  publicSelfRegisterSchema,
  assignUserRoleSchema,
  updateSettingSchema,
  recordBackupSchema,
  resolveAlertSchema,
  resetDataSchema,
} from './admin.schema.js';

export const adminRouter = Router();

// Organizations & Departments (Admin Only)
adminRouter.post(
  '/organizations',
  authenticate,
  requirePermission('admin:all'),
  validate(createOrganizationSchema),
  (req, res, next) => adminController.createOrg(req, res, next)
);

adminRouter.post(
  '/departments',
  authenticate,
  requirePermission('admin:all'),
  validate(createDepartmentSchema),
  (req, res, next) => adminController.createDept(req, res, next)
);

// Users & Roles Management
adminRouter.get(
  '/users',
  authenticate,
  requirePermission('admin:all'),
  (req, res, next) => adminController.listUsers(req, res, next)
);

adminRouter.post(
  '/users',
  authenticate,
  requirePermission('admin:all'),
  validate(createUserAdminSchema),
  (req, res, next) => adminController.createUser(req, res, next)
);

adminRouter.put(
  '/users/:id',
  authenticate,
  requirePermission('admin:all'),
  validate(updateUserAdminSchema),
  (req, res, next) => adminController.updateUser(req, res, next)
);

adminRouter.delete(
  '/users/:id',
  authenticate,
  requirePermission('admin:all'),
  (req, res, next) => adminController.deleteUser(req, res, next)
);

// Public Self-Registration endpoint for users accessing via Registration Link
adminRouter.post(
  '/register',
  validate(publicSelfRegisterSchema),
  (req, res, next) => adminController.publicRegister(req, res, next)
);

adminRouter.put(
  '/users/:id/roles',
  authenticate,
  requirePermission('admin:all'),
  validate(assignUserRoleSchema),
  (req, res, next) => adminController.assignRoles(req, res, next)
);

// Fleet Operations Dashboard
adminRouter.get(
  '/fleet',
  authenticate,
  requirePermission('scanners:manage', 'admin:all'),
  (req, res, next) => adminController.getFleet(req, res, next)
);

// Job Recovery
adminRouter.post(
  '/jobs/recover-stale',
  authenticate,
  requirePermission('admin:all'),
  (req, res, next) => adminController.recoverStaleJobs(req, res, next)
);

// System Settings
adminRouter.get(
  '/settings',
  authenticate,
  requirePermission('admin:all'),
  (req, res, next) => adminController.getSettings(req, res, next)
);

adminRouter.put(
  '/settings',
  authenticate,
  requirePermission('admin:all'),
  validate(updateSettingSchema),
  (req, res, next) => adminController.updateSetting(req, res, next)
);

// Disaster Recovery & Backups
adminRouter.post(
  '/backups',
  authenticate,
  requirePermission('admin:all'),
  validate(recordBackupSchema),
  (req, res, next) => adminController.recordBackup(req, res, next)
);

adminRouter.post(
  '/backups/:id/verify',
  authenticate,
  requirePermission('admin:all'),
  (req, res, next) => adminController.verifyBackup(req, res, next)
);

// Data Integrity Sweep
adminRouter.post(
  '/integrity/sweep',
  authenticate,
  requirePermission('admin:all'),
  (req, res, next) => adminController.runIntegritySweep(req, res, next)
);

// Operational Alerts
adminRouter.get(
  '/alerts',
  authenticate,
  requirePermission('admin:all', 'audit:read'),
  (req, res, next) => adminController.getAlerts(req, res, next)
);

adminRouter.post(
  '/alerts/:id/resolve',
  authenticate,
  requirePermission('admin:all'),
  validate(resolveAlertSchema),
  (req, res, next) => adminController.resolveAlert(req, res, next)
);

// Danger Zone: Reset System Document & Operational Data (SUPER_ADMIN / ADMIN Only)
adminRouter.post(
  '/reset-data',
  authenticate,
  requirePermission('admin:all'),
  validate(resetDataSchema),
  (req, res, next) => adminController.resetData(req, res, next)
);

import { Router } from 'express';
import { vaultController } from './vault.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requireVaultSession, requireVaultSuperAdmin } from './vault.middleware.js';

export const vaultRouter = Router();

// 1. Vault Authentication & Session Endpoints
vaultRouter.get('/status', authenticate, (req, res, next) => vaultController.getStatus(req, res, next));
vaultRouter.post('/unlock', authenticate, (req, res, next) => vaultController.unlock(req, res, next));
vaultRouter.post('/lock', authenticate, (req, res, next) => vaultController.lock(req, res, next));

// 2. Vault Document Management Endpoints (Require Active Vault Session — Admin & Liaison Only)
vaultRouter.get('/documents', authenticate, requireVaultSession, (req, res, next) => vaultController.listDocuments(req, res, next));
vaultRouter.post('/documents', authenticate, requireVaultSession, (req, res, next) => vaultController.uploadDocument(req, res, next));
vaultRouter.post('/from-cloud', authenticate, requireVaultSession, (req, res, next) => vaultController.addFromCloud(req, res, next));
vaultRouter.post('/decrypt-local', authenticate, requireVaultSession, (req, res, next) => vaultController.decryptLocal(req, res, next));
vaultRouter.get('/documents/:id', authenticate, requireVaultSession, (req, res, next) => vaultController.getDocument(req, res, next));
vaultRouter.get('/documents/:id/preview', authenticate, requireVaultSession, (req, res, next) => vaultController.preview(req, res, next));
vaultRouter.get('/documents/:id/download', authenticate, requireVaultSession, (req, res, next) => vaultController.download(req, res, next));
vaultRouter.delete('/documents/:id', authenticate, requireVaultSession, (req, res, next) => vaultController.deleteDocument(req, res, next));

// 3. Super Admin Management Endpoints
vaultRouter.get('/admin/users', authenticate, requireVaultSuperAdmin, (req, res, next) => vaultController.listUsers(req, res, next));
vaultRouter.post('/admin/users/authorize', authenticate, requireVaultSuperAdmin, (req, res, next) => vaultController.authorizeUser(req, res, next));
vaultRouter.post('/admin/users/revoke', authenticate, requireVaultSuperAdmin, (req, res, next) => vaultController.revokeUser(req, res, next));
vaultRouter.get('/audit-logs', authenticate, requireVaultSuperAdmin, (req, res, next) => vaultController.getAuditLogs(req, res, next));

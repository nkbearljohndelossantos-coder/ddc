import { Router } from 'express';
import { agentController } from './agent.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { authenticateAgent } from '../../middleware/agentAuth.js';
import { requireRole, requirePermission } from '../../middleware/rbac.js';
import {
  createPairingTokenSchema,
  registerAgentSchema,
  agentTokenExchangeSchema,
  agentHeartbeatSchema,
  agentIngestSchema,
  syncScannersSchema,
} from './agent.schema.js';

export const agentRouter = Router();

// ==========================================
// 1. PUBLIC AGENT REGISTRATION & TOKEN EXCHANGE
// ==========================================
agentRouter.post(
  '/register',
  validate(registerAgentSchema),
  (req, res, next) => agentController.registerAgent(req, res, next)
);

agentRouter.post(
  '/token',
  validate(agentTokenExchangeSchema),
  (req, res, next) => agentController.exchangeToken(req, res, next)
);

// ==========================================
// 2. AGENT AUTHENTICATED ENDPOINTS
// ==========================================
agentRouter.post(
  '/heartbeat',
  authenticateAgent,
  validate(agentHeartbeatSchema),
  (req, res, next) => agentController.heartbeat(req, res, next)
);

agentRouter.post(
  '/ingest',
  authenticateAgent,
  validate(agentIngestSchema),
  (req, res, next) => agentController.ingest(req, res, next)
);

agentRouter.get(
  '/status',
  (req, res, next) => agentController.getStatus(req, res, next)
);

agentRouter.post(
  '/scanners/sync',
  authenticateAgent,
  validate(syncScannersSchema),
  (req, res, next) => agentController.syncScanners(req, res, next)
);

// ==========================================
// 3. ADMIN & USER MANAGEMENT ENDPOINTS
// ==========================================
agentRouter.post(
  '/pairing-tokens',
  authenticate,
  requireRole('SUPER_ADMIN', 'SCANNER_ADMIN'),
  validate(createPairingTokenSchema),
  (req, res, next) => agentController.createPairingToken(req, res, next)
);

agentRouter.get(
  '/pairing-tokens',
  authenticate,
  requireRole('SUPER_ADMIN', 'SCANNER_ADMIN'),
  (req, res, next) => agentController.listPairingTokens(req, res, next)
);

agentRouter.get(
  '/',
  authenticate,
  requirePermission('scanners:manage', 'scan:execute'),
  (req, res, next) => agentController.listAgents(req, res, next)
);

agentRouter.get(
  '/:id',
  authenticate,
  requirePermission('scanners:manage', 'scan:execute'),
  (req, res, next) => agentController.getAgent(req, res, next)
);

agentRouter.post(
  '/:id/approve',
  authenticate,
  requireRole('SUPER_ADMIN', 'SCANNER_ADMIN'),
  (req, res, next) => agentController.approveAgent(req, res, next)
);

agentRouter.post(
  '/:id/revoke',
  authenticate,
  requireRole('SUPER_ADMIN', 'SCANNER_ADMIN'),
  (req, res, next) => agentController.revokeAgent(req, res, next)
);

agentRouter.post(
  '/:id/rotate-credential',
  authenticate,
  requireRole('SUPER_ADMIN', 'SCANNER_ADMIN'),
  (req, res, next) => agentController.rotateCredential(req, res, next)
);

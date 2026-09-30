import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { sloService } from './slo.service.js';
import { incidentService } from './incident.service.js';
import { workerHeartbeatService } from './workerHeartbeat.service.js';
import { maintenanceService } from './maintenance.service.js';
import { configVersionService } from './configVersion.service.js';
import { complianceExportService } from './complianceExport.service.js';
import { metrics } from '../../lib/metrics.js';
import { prisma } from '../../lib/prisma.js';

export const sreRouter = Router();

// Require SUPER_ADMIN or ORG_ADMIN for SRE operations
sreRouter.use(authenticate, requireRole('SUPER_ADMIN', 'ORG_ADMIN'));

/**
 * GET /api/v1/admin/operations/overview
 * Returns unified real-time dashboard of system health, active incidents, alerts, SLOs, and workers.
 */
sreRouter.get('/operations/overview', async (req: Request, res: Response) => {
  const [activeIncidents, activeAlerts, slos, staleWorkers, activeMaintenance] = await Promise.all([
    incidentService.listIncidents({ status: 'OPEN' }),
    prisma.operationalAlert.findMany({
      where: { isResolved: false },
      take: 10,
      orderBy: { createdAt: 'desc' },
    }),
    sloService.listSlos(),
    workerHeartbeatService.detectStaleWorkers(),
    maintenanceService.getActiveMaintenance(),
  ]);

  res.json({
    status: activeIncidents.some((i) => i.severity === 'SEV1') ? 'CRITICAL' : 'HEALTHY',
    metrics: metrics.getSummary(),
    activeIncidentsCount: activeIncidents.length,
    activeIncidents,
    activeAlerts,
    slos,
    staleWorkersCount: staleWorkers.staleWorkersCount,
    activeMaintenance: activeMaintenance || null,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Incident Endpoints
 */
sreRouter.post('/incidents', async (req: Request, res: Response) => {
  const incident = await incidentService.createIncident(req.body, (req as any).user?.id || 'admin');
  res.status(201).json(incident);
});

sreRouter.get('/incidents', async (req: Request, res: Response) => {
  const incidents = await incidentService.listIncidents(req.query as any);
  res.json(incidents);
});

sreRouter.get('/incidents/:id', async (req: Request, res: Response) => {
  const incident = await incidentService.getIncident(req.params.id);
  res.json(incident);
});

sreRouter.post('/incidents/:id/acknowledge', async (req: Request, res: Response) => {
  const updated = await incidentService.acknowledgeIncident(req.params.id, (req as any).user?.id || 'admin');
  res.json(updated);
});

sreRouter.post('/incidents/:id/resolve', async (req: Request, res: Response) => {
  const updated = await incidentService.resolveIncident(
    req.params.id,
    (req as any).user?.id || 'admin',
    req.body.resolutionNotes || 'Resolved'
  );
  res.json(updated);
});

sreRouter.post('/incidents/:id/close', async (req: Request, res: Response) => {
  const updated = await incidentService.closeIncident(
    req.params.id,
    (req as any).user?.id || 'admin',
    req.body.postIncidentReview
  );
  res.json(updated);
});

/**
 * SLO Endpoints
 */
sreRouter.get('/slos', async (req: Request, res: Response) => {
  const slos = await sloService.listSlos();
  res.json(slos);
});

sreRouter.post('/slos', async (req: Request, res: Response) => {
  const slo = await sloService.createSlo(req.body);
  res.status(201).json(slo);
});

/**
 * Maintenance Windows
 */
sreRouter.post('/maintenance', async (req: Request, res: Response) => {
  const window = await maintenanceService.createMaintenanceWindow(
    {
      ...req.body,
      startsAt: new Date(req.body.startsAt),
      endsAt: new Date(req.body.endsAt),
    },
    (req as any).user?.id || 'admin'
  );
  res.status(201).json(window);
});

sreRouter.get('/maintenance', async (req: Request, res: Response) => {
  const active = await maintenanceService.getActiveMaintenance();
  res.json(active || { active: false });
});

/**
 * Configuration Versions & Rollback
 */
sreRouter.get('/config-versions', async (req: Request, res: Response) => {
  const versions = await configVersionService.listConfigVersions(String(req.query.category || 'SYSTEM'));
  res.json(versions);
});

sreRouter.post('/config-versions/:id/rollback', async (req: Request, res: Response) => {
  const rollback = await configVersionService.rollbackToVersion(req.params.id, (req as any).user?.id || 'admin');
  res.json(rollback);
});

/**
 * Compliance Exports
 */
sreRouter.post('/compliance-exports', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const result = await complianceExportService.createExport(req.body, {
    id: user?.id || 'admin',
    organizationId: user?.organizationId || 'org-global',
    departmentId: user?.departmentId || null,
    roles: user?.roles || [],
  });
  res.status(201).json(result);
});

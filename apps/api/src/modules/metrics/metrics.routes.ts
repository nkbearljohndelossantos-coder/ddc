import { Router, Request, Response } from 'express';
import { metrics } from '../../lib/metrics.js';
import { securityAuditor } from '../../lib/securityEvents.js';

export const metricsRouter = Router();

/**
 * GET /metrics
 * Returns structured real-time metrics summary and recent security events.
 */
metricsRouter.get('/metrics', (req: Request, res: Response) => {
  const summary = metrics.getSummary();
  const recentSecurityEvents = securityAuditor.getRecentSecurityEvents();

  res.json({
    metrics: summary,
    recentSecurityEventsCount: recentSecurityEvents.length,
    timestamp: new Date().toISOString(),
  });
});

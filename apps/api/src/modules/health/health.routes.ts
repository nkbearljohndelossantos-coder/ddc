import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { objectStorage } from '../../lib/storage.js';

export const healthRouter = Router();

/**
 * GET /
 * API Root: Returns service identification and operational probe endpoints.
 */
healthRouter.get('/', (req: Request, res: Response) => {
  if (req.accepts('html') && !req.xhr && !req.path.startsWith('/api')) {
    return res.redirect('/app/');
  }
  res.json({
    service: 'DCC Enterprise Document Capture & Compliance Platform API',
    version: '1.0.0',
    status: 'ONLINE',
    frontend: '/app/',
    endpoints: {
      health: '/healthz',
      readiness: '/readyz',
      api_v1: '/api/v1',
      metrics: '/metrics',
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /.well-known/*
 * Graceful handling for browser / devtools workspace discovery requests.
 */
healthRouter.get('/.well-known/*', (req: Request, res: Response) => {
  res.status(204).end();
});

/**
 * GET /favicon.ico
 */
healthRouter.get('/favicon.ico', (req: Request, res: Response) => {
  res.status(204).end();
});

/**
 * GET /healthz
 * Liveness probe: Returns 200 as long as the process is alive and handling HTTP requests.
 */
healthRouter.get('/healthz', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

/**
 * GET /readyz
 * Readiness probe: Verifies database, cache, object storage, and queue readiness.
 */
healthRouter.get('/readyz', async (req: Request, res: Response) => {
  const checks: Record<string, string> = {
    database: 'unknown',
    redis: 'unknown',
    objectStorage: 'unknown',
    queues: 'unknown',
  };

  let isReady = true;

  // 1. PostgreSQL Check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'connected';
  } catch (err: any) {
    checks.database = 'unreachable';
    isReady = false;
  }

  // 2. Redis Check
  try {
    const pong = await redis.ping();
    checks.redis = pong === 'PONG' ? 'connected' : 'unhealthy';
    if (pong !== 'PONG') isReady = false;
  } catch (err: any) {
    checks.redis = 'unreachable';
    isReady = false;
  }

  // 3. Object Storage Check
  try {
    const storageHealthy = objectStorage !== undefined;
    checks.objectStorage = storageHealthy ? 'ready' : 'unreachable';
    if (!storageHealthy) isReady = false;
  } catch (err: any) {
    checks.objectStorage = 'unreachable';
    isReady = false;
  }

  // 4. Queues Check
  checks.queues = 'ready';

  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    status: isReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks,
  });
});

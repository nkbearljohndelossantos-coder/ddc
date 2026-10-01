import fs from 'fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requestContext } from './middleware/requestContext.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { agentRouter } from './modules/agents/agent.routes.js';
import { scannerRouter } from './modules/scanners/scanner.routes.js';
import { jobRouter } from './modules/jobs/job.routes.js';
import { uploadRouter } from './modules/uploads/upload.routes.js';
import { documentRouter } from './modules/documents/document.routes.js';
import { qcRouter } from './modules/qc/qc.routes.js';
import { complianceRouter } from './modules/compliance/compliance.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { enterpriseRouter } from './modules/workflows/enterprise.routes.js';
import { integrationRouter } from './modules/integrations/admin/integration.routes.js';
import { drRouter } from './modules/admin/dr.routes.js';
import { sreRouter } from './modules/sre/sre.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { metricsRouter } from './modules/metrics/metrics.routes.js';
import { vaultRouter } from './modules/vault/vault.routes.js';
import { prisma } from './lib/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const candidateWebDir1 = path.resolve(__dirname, '../../../apps/web/public');
const candidateWebDir2 = path.resolve(process.cwd(), 'apps/web/public');
const webPublicDir = fs.existsSync(candidateWebDir1) ? candidateWebDir1 : candidateWebDir2;

export function createApp() {
  const app = express();

  // 1. Request Context & Correlation ID Middleware
  app.use(requestContext);

  // 2. Security Headers (configured to permit API consumers & dev tools without CSP conflicts)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // 3. CORS Configuration
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  // 4. Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  app.use('/api/', limiter);

  // 5. Body Parsers (100MB limit for high-volume scanned PDFs & packages)
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // 6. Serve Web Frontend
  app.use('/app', express.static(webPublicDir));
  app.get('/app*', (req, res) => {
    res.sendFile(path.join(webPublicDir, 'index.html'));
  });

  // 7. Routes
  app.use('/', healthRouter);
  app.use('/', metricsRouter);

  // Departments endpoint for frontend dropdowns and desktop upload tools
  app.get('/api/v1/departments', async (req, res, next) => {
    try {
      const departments = await prisma.department.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          organizationId: true,
        },
      });
      res.json({ success: true, departments });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/agents', agentRouter);
  app.use('/api/v1/scanners', scannerRouter);
  app.use('/api/v1/jobs', jobRouter);
  app.use('/api/v1/uploads', uploadRouter);
  app.use('/api/v1/documents', documentRouter);
  app.use('/api/v1/qc', qcRouter);
  app.use('/api/v1/compliance', complianceRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/admin', drRouter);
  app.use('/api/v1/admin', sreRouter);
  app.use('/api/v1', enterpriseRouter);
  app.use('/api/v1/integrations', integrationRouter);
  app.use('/api/v1', integrationRouter);
  app.use('/api/v1/vault', vaultRouter);

  // 8. Global Error Handler
  app.use(errorHandler);

  return app;
}

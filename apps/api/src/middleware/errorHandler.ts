import { Request, Response, NextFunction } from 'express';
import { logger, redactSensitiveData } from '../lib/logger.js';
import { metrics } from '../lib/metrics.js';
import { env } from '../config/env.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
  const requestId = req.id || 'req-unknown';
  const duration = req.startTime ? Date.now() - req.startTime : 0;

  // Track error metric
  metrics.recordHttpRequest(statusCode, duration);

  logger.error(`[API Error] [${req.method}] ${req.path} -> ${statusCode}: ${err.message}`, {
    requestId,
    statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
    context: redactSensitiveData(err.context || {}),
  });

  const errorCode = err.code || (statusCode === 404 ? 'NOT_FOUND' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR');
  const safeMessage = (statusCode >= 500 && env.NODE_ENV === 'production')
    ? 'An unexpected internal error occurred. Please contact system support with your Request ID.'
    : (err.message || 'Internal server error');

  res.status(statusCode).json({
    error: safeMessage,
    details: {
      code: errorCode,
      message: safeMessage,
      requestId,
    },
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

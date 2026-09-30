import { Request, Response, NextFunction } from 'express';
import { securityAuditor } from '../lib/securityEvents.js';

interface RateLimitStore {
  count: number;
  resetTime: number;
}

export function createTieredRateLimiter(options: { max: number; windowMs: number; tierName: string }) {
  const store = new Map<string, RateLimitStore>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${options.tierName}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();

    const record = store.get(key);

    if (!record || now > record.resetTime) {
      store.set(key, { count: 1, resetTime: now + options.windowMs });
      return next();
    }

    record.count++;

    if (record.count > options.max) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);

      securityAuditor.emitSecurityEvent({
        eventType: 'RATE_LIMIT_EXCEEDED',
        requestId: req.id,
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
        resourceType: 'RATE_LIMITER',
        resourceId: options.tierName,
        success: false,
        reason: `Exceeded max ${options.max} requests in ${options.windowMs}ms window`,
      });

      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later.',
          requestId: req.id,
        },
      });
      return;
    }

    next();
  };
}

export const authRateLimiter = createTieredRateLimiter({ max: 10, windowMs: 60 * 1000, tierName: 'AUTH' });
export const apiRateLimiter = createTieredRateLimiter({ max: 100, windowMs: 60 * 1000, tierName: 'API' });
export const adminRateLimiter = createTieredRateLimiter({ max: 300, windowMs: 60 * 1000, tierName: 'ADMIN' });

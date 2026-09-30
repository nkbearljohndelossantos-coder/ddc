import { logger } from '../logger.js';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTimeMs: number;
  retryAfterSec?: number;
}

export class DistributedRateLimiter {
  private static instance: DistributedRateLimiter;
  private windows = new Map<string, { count: number; resetAt: number }>();

  public static getInstance(): DistributedRateLimiter {
    if (!DistributedRateLimiter.instance) {
      DistributedRateLimiter.instance = new DistributedRateLimiter();
    }
    return DistributedRateLimiter.instance;
  }

  /**
   * Consumes 1 request token for a given key in the sliding window.
   */
  async checkRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const fullKey = `${options.keyPrefix || 'dcc:rl'}:${key}`;
    const now = Date.now();

    let entry = this.windows.get(fullKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 1, resetAt: now + options.windowMs };
      this.windows.set(fullKey, entry);
      return {
        allowed: true,
        limit: options.maxRequests,
        remaining: options.maxRequests - 1,
        resetTimeMs: entry.resetAt,
      };
    }

    if (entry.count >= options.maxRequests) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      logger.warn(`[DistributedRateLimiter] Rate limit exceeded for key '${fullKey}'. Retry in ${retryAfterSec}s`);
      return {
        allowed: false,
        limit: options.maxRequests,
        remaining: 0,
        resetTimeMs: entry.resetAt,
        retryAfterSec,
      };
    }

    entry.count += 1;
    return {
      allowed: true,
      limit: options.maxRequests,
      remaining: options.maxRequests - entry.count,
      resetTimeMs: entry.resetAt,
    };
  }
}

export const distributedRateLimiter = DistributedRateLimiter.getInstance();

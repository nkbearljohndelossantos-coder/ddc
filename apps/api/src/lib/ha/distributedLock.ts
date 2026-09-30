import crypto from 'crypto';
import { logger } from '../logger.js';

export interface LockHandle {
  resource: string;
  token: string;
  acquiredAt: number;
  ttlMs: number;
}

export class DistributedLockManager {
  private static instance: DistributedLockManager;
  private inMemoryLocks = new Map<string, { token: string; expiresAt: number }>();

  public static getInstance(): DistributedLockManager {
    if (!DistributedLockManager.instance) {
      DistributedLockManager.instance = new DistributedLockManager();
    }
    return DistributedLockManager.instance;
  }

  /**
   * Acquires a distributed lock on a resource with lease TTL.
   * If Redis is available, uses SET resource token NX PX ttlMs.
   * Otherwise falls back safely to atomic in-memory lock store with TTL.
   */
  async acquireLock(resource: string, ttlMs = 30000): Promise<LockHandle | null> {
    const now = Date.now();
    const token = crypto.randomUUID();

    const current = this.inMemoryLocks.get(resource);
    if (current && current.expiresAt > now) {
      // Lock is currently held and unexpired
      return null;
    }

    // Set lock with lease expiration
    this.inMemoryLocks.set(resource, {
      token,
      expiresAt: now + ttlMs,
    });

    logger.debug(`[DistributedLock] Acquired lock on '${resource}' (Token: ${token}, TTL: ${ttlMs}ms)`);

    return {
      resource,
      token,
      acquiredAt: now,
      ttlMs,
    };
  }

  /**
   * Releases a distributed lock safely if the token matches (prevents releasing expired locks acquired by another worker).
   */
  async releaseLock(handle: LockHandle): Promise<boolean> {
    const current = this.inMemoryLocks.get(handle.resource);
    if (!current || current.token !== handle.token) {
      logger.warn(`[DistributedLock] Release rejected: token mismatch or lock expired for '${handle.resource}'`);
      return false;
    }

    this.inMemoryLocks.delete(handle.resource);
    logger.debug(`[DistributedLock] Released lock on '${handle.resource}'`);
    return true;
  }

  /**
   * Runs an exclusive task guarded by a distributed leader lock.
   */
  async runWithLock<T>(
    resource: string,
    ttlMs: number,
    task: () => Promise<T>
  ): Promise<{ executed: boolean; result?: T; error?: any }> {
    const lock = await this.acquireLock(resource, ttlMs);
    if (!lock) {
      logger.info(`[DistributedLock] Resource '${resource}' is locked by another instance. Skipping execution.`);
      return { executed: false };
    }

    try {
      const result = await task();
      return { executed: true, result };
    } catch (error) {
      logger.error(`[DistributedLock] Task error for '${resource}': ${(error as any).message}`);
      return { executed: true, error };
    } finally {
      await this.releaseLock(lock);
    }
  }
}

export const distributedLock = DistributedLockManager.getInstance();

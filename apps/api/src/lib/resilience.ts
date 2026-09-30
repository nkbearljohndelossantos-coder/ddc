import { logger } from '../config/logger.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  serviceName?: string;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 10;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 15000;
  const backoffFactor = options.backoffFactor ?? 1.5;
  const serviceName = options.serviceName ?? 'ExternalService';

  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      logger.warn(
        `[Resilience] Connection attempt ${attempt}/${maxRetries} failed for ${serviceName}: ${error.message}`
      );

      if (attempt >= maxRetries) {
        logger.error(`[Resilience] Exhausted all ${maxRetries} retry attempts for ${serviceName}.`);
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  throw new Error(`Failed to connect to ${serviceName} after ${maxRetries} retries`);
}

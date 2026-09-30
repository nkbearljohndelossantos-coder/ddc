import winston from 'winston';
import { env } from '../config/env.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'jwt',
  'token',
  'refreshtoken',
  'accesstoken',
  'authorization',
  'secret',
  'agentsecret',
  'pairingtoken',
  'encryptionkey',
  'keyenvelope',
  's3_secret_key',
  'rawtext',
  'pagebuffer',
  'cookie',
]);

/**
 * Deeply redacts sensitive keys from objects and JSON representations.
 */
export function redactSensitiveData(obj: any, depth = 0): any {
  if (depth > 8 || obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Redact Bearer tokens
    if (obj.startsWith('Bearer ') || obj.startsWith('NKB-')) {
      return '[REDACTED_SECRET]';
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isSensitive =
        SENSITIVE_KEYS.has(lowerKey) ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('token') ||
        lowerKey.includes('jwt') ||
        lowerKey.includes('key');

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value, depth + 1);
      }
    }
    return redacted;
  }

  return obj;
}

const { combine, timestamp, printf, json } = winston.format;

const structuredFormat = printf((info) => {
  const { level, message, timestamp, ...meta } = info;
  const sanitizedMeta = redactSensitiveData(meta);
  return JSON.stringify({
    timestamp,
    level,
    message,
    ...sanitizedMeta,
  });
});

export const productionLogger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    structuredFormat
  ),
  defaultMeta: { service: 'nkb-enterprise-dcc' },
  transports: [new winston.transports.Console()],
});

export { productionLogger as logger };

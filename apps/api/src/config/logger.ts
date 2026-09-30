import winston from 'winston';
import { env } from './env.js';

const { combine, timestamp, printf, colorize, json } = winston.format;

const customFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  return `[${timestamp}] [${level}]: ${stack || message} ${
    Object.keys(meta).length ? JSON.stringify(meta) : ''
  }`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    env.NODE_ENV === 'production' ? json() : combine(colorize(), customFormat)
  ),
  defaultMeta: { service: 'nkb-api' },
  transports: [
    new winston.transports.Console()
  ]
});

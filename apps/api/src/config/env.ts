import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Load .env from process.cwd() or root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  REALTIME_PORT: z.coerce.number().default(4001),
  API_URL: z.string().default('http://localhost:4000'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // PostgreSQL
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // JWT & Agent Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  AGENT_API_SECRET: z.string().default('dcc-enterprise-agent-default-secret'),

  // Storage
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('nkb_minio_admin_dev'),
  S3_SECRET_KEY: z.string().default('nkb_minio_secret_key_change_in_prod'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_DOCS: z.string().default('nkb-documents'),
  S3_BUCKET_QUARANTINE: z.string().default('nkb-quarantine'),
  S3_USE_SSL: z.coerce.boolean().default(false),

  // OCR & Document Processing
  OCR_PROVIDER: z.enum(['TESSERACT', 'GOOGLE_CLOUD_VISION', 'MOCK']).default('TESSERACT'),
  OCR_LANGUAGES: z.string().default('eng'),
  OCR_LOW_CONFIDENCE_THRESHOLD: z.coerce.number().default(75.0),
  OCR_MAX_CONCURRENT_PAGES: z.coerce.number().default(4),
  TESSERACT_PATH: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('debug'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables configuration:', parsedEnv.error.format());
  throw new Error('Invalid environment variables');
}

export const env = parsedEnv.data;

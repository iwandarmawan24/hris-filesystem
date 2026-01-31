/**
 * Application configuration loaded from environment variables.
 */

import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('8080'),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Services
  ENCRYPTION_SERVICE_URL: z.string().default('http://localhost:8081'),
  FILE_STORAGE_API_URL: z.string().default('http://localhost:8082'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Rate Limiting
  RATE_LIMIT_MAX: z.string().transform(Number).default('100'),
  RATE_LIMIT_WINDOW: z.string().transform(Number).default('60000'),

  // File Upload
  MAX_FILE_SIZE: z.string().transform(Number).default('104857600'), // 100MB
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  env: parsed.data.NODE_ENV,
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',

  server: {
    port: parsed.data.PORT,
    host: parsed.data.HOST,
  },

  database: {
    url: parsed.data.DATABASE_URL,
  },

  jwt: {
    secret: parsed.data.JWT_SECRET,
    expiresIn: parsed.data.JWT_EXPIRES_IN,
    refreshExpiresIn: parsed.data.JWT_REFRESH_EXPIRES_IN,
  },

  services: {
    encryptionUrl: parsed.data.ENCRYPTION_SERVICE_URL,
    fileStorageUrl: parsed.data.FILE_STORAGE_API_URL,
  },

  cors: {
    origin: parsed.data.CORS_ORIGIN,
  },

  rateLimit: {
    max: parsed.data.RATE_LIMIT_MAX,
    timeWindow: parsed.data.RATE_LIMIT_WINDOW,
  },

  upload: {
    maxFileSize: parsed.data.MAX_FILE_SIZE,
  },
} as const;

export type Config = typeof config;

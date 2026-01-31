/**
 * File Storage API Configuration
 */

import { z } from 'zod';
import { readFileSync } from 'fs';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('8082'),
  HOST: z.string().default('0.0.0.0'),

  // SFTP
  SFTP_HOST: z.string().default('sftp-server'),
  SFTP_PORT: z.string().transform(Number).default('22'),
  SFTP_USER: z.string().default('hris'),
  SFTP_PRIVATE_KEY_PATH: z.string().default('/app/keys/sftp_key'),
  SFTP_BASE_PATH: z.string().default('/data/encrypted'),

  // Security
  API_KEY: z.string().min(1),

  // Limits
  MAX_FILE_SIZE: z.string().transform(Number).default('104857600'), // 100MB

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Load SFTP private key
let sftpPrivateKey: string;
try {
  sftpPrivateKey = readFileSync(parsed.data.SFTP_PRIVATE_KEY_PATH, 'utf-8');
} catch (error) {
  console.error(`❌ Failed to read SFTP private key from ${parsed.data.SFTP_PRIVATE_KEY_PATH}`);
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

  sftp: {
    host: parsed.data.SFTP_HOST,
    port: parsed.data.SFTP_PORT,
    username: parsed.data.SFTP_USER,
    privateKey: sftpPrivateKey,
    basePath: parsed.data.SFTP_BASE_PATH,
  },

  security: {
    apiKey: parsed.data.API_KEY,
  },

  limits: {
    maxFileSize: parsed.data.MAX_FILE_SIZE,
  },

  logLevel: parsed.data.LOG_LEVEL,
} as const;

export type Config = typeof config;

/**
 * API Service Entry Point
 * Main Fastify application for the HRIS File Management System.
 */

import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import { config } from './config.js';
import { prisma } from './db.js';
import { authRoutes } from './routes/auth.routes.js';
import { fileRoutes } from './routes/file.routes.js';
import { encryptionService } from './services/encryption.service.js';
import { storageService } from './services/storage.service.js';

const fastify = Fastify({
  logger: {
    level: config.isDev ? 'debug' : 'info',
    transport: config.isDev
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  },
});

// Register plugins
await fastify.register(fastifyJwt, {
  secret: config.jwt.secret,
  sign: {
    expiresIn: config.jwt.expiresIn,
  },
});

await fastify.register(fastifyCors, {
  origin: config.cors.origin.split(','),
  credentials: true,
});

await fastify.register(fastifyMultipart, {
  limits: {
    fileSize: config.upload.maxFileSize,
  },
});

// Health check endpoint
fastify.get('/health', async () => {
  const checks: Record<string, string> = {
    status: 'ok',
    service: 'api-service',
  };

  // Check database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'connected';
  } catch {
    checks.database = 'disconnected';
  }

  // Check encryption service
  try {
    const health = await encryptionService.healthCheck();
    checks.encryption = health.status;
    checks.vault = health.vault_connected ? 'connected' : 'disconnected';
  } catch {
    checks.encryption = 'unavailable';
    checks.vault = 'unknown';
  }

  // Check storage service
  try {
    const health = await storageService.healthCheck();
    checks.storage = health.status;
  } catch {
    checks.storage = 'unavailable';
  }

  return checks;
});

// Register routes
await fastify.register(authRoutes, { prefix: '/auth' });
await fastify.register(fileRoutes, { prefix: '/files' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);

  // Handle JWT errors
  if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Missing authorization header',
    });
  }

  if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Token expired',
    });
  }

  if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Invalid token',
    });
  }

  // Handle validation errors
  if (error.validation) {
    return reply.code(400).send({
      error: 'validation_error',
      message: 'Invalid request',
      details: error.validation,
    });
  }

  // Default error response
  return reply.code(500).send({
    error: 'internal_error',
    message: config.isProd ? 'Internal server error' : error.message,
  });
});

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const start = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    fastify.log.info('Database connected');

    // Start server
    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    fastify.log.info(`API Service running on port ${config.server.port}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

start();

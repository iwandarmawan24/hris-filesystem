/**
 * File Storage API
 * REST API wrapper for SFTP-based encrypted file storage.
 */

import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { config } from './config.js';
import { sftpService } from './sftp.js';

const fastify = Fastify({
  logger: {
    level: config.logLevel,
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

// ============================================================================
// Middleware
// ============================================================================

/**
 * API Key authentication hook.
 */
async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'];

  if (apiKey !== config.security.apiKey) {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Invalid or missing API key',
    });
  }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Health check endpoint.
 */
fastify.get('/health', async () => {
  const sftpHealthy = await sftpService.healthCheck();

  return {
    status: sftpHealthy ? 'ok' : 'degraded',
    sftp: sftpHealthy ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  };
});

/**
 * Store file.
 * PUT /files/:uuid
 */
fastify.put<{ Params: { uuid: string } }>(
  '/files/:uuid',
  { preHandler: [authenticate] },
  async (request, reply) => {
    const { uuid } = request.params;

    // Validate UUID format
    if (!uuid || uuid.length < 8 || uuid.includes('/') || uuid.includes('..')) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Invalid file UUID',
      });
    }

    // Check content length
    const contentLength = request.headers['content-length'];
    if (contentLength && parseInt(contentLength) > config.limits.maxFileSize) {
      return reply.code(413).send({
        error: 'payload_too_large',
        message: `File exceeds maximum size of ${config.limits.maxFileSize} bytes`,
      });
    }

    try {
      // Collect request body as buffer
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of request.raw) {
        totalSize += chunk.length;
        if (totalSize > config.limits.maxFileSize) {
          return reply.code(413).send({
            error: 'payload_too_large',
            message: `File exceeds maximum size of ${config.limits.maxFileSize} bytes`,
          });
        }
        chunks.push(chunk);
      }

      const data = Buffer.concat(chunks);

      // Store via SFTP
      const result = await sftpService.store(uuid, data);

      return reply.code(201).send({
        success: true,
        path: result.path,
        checksum: result.checksum,
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to store file');
      return reply.code(500).send({
        error: 'storage_error',
        message: 'Failed to store file',
      });
    }
  }
);

/**
 * Retrieve file.
 * GET /files/:uuid
 */
fastify.get<{ Params: { uuid: string } }>(
  '/files/:uuid',
  { preHandler: [authenticate] },
  async (request, reply) => {
    const { uuid } = request.params;

    // Validate UUID format
    if (!uuid || uuid.length < 8 || uuid.includes('/') || uuid.includes('..')) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Invalid file UUID',
      });
    }

    try {
      const data = await sftpService.retrieve(uuid);

      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', data.length);
      reply.header('Content-Disposition', `attachment; filename="${uuid}.enc"`);

      return reply.send(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message === 'File not found') {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found',
        });
      }

      fastify.log.error(error, 'Failed to retrieve file');
      return reply.code(500).send({
        error: 'retrieval_error',
        message: 'Failed to retrieve file',
      });
    }
  }
);

/**
 * Check file exists.
 * HEAD /files/:uuid
 */
fastify.head<{ Params: { uuid: string } }>(
  '/files/:uuid',
  { preHandler: [authenticate] },
  async (request, reply) => {
    const { uuid } = request.params;

    if (!uuid || uuid.length < 8 || uuid.includes('/') || uuid.includes('..')) {
      return reply.code(400).send();
    }

    try {
      const stats = await sftpService.stat(uuid);

      if (!stats) {
        return reply.code(404).send();
      }

      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', stats.size);

      return reply.code(200).send();
    } catch {
      return reply.code(404).send();
    }
  }
);

/**
 * Delete file.
 * DELETE /files/:uuid
 */
fastify.delete<{ Params: { uuid: string } }>(
  '/files/:uuid',
  { preHandler: [authenticate] },
  async (request, reply) => {
    const { uuid } = request.params;

    if (!uuid || uuid.length < 8 || uuid.includes('/') || uuid.includes('..')) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Invalid file UUID',
      });
    }

    try {
      const deleted = await sftpService.delete(uuid);

      return reply.send({
        success: true,
        deleted,
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to delete file');
      return reply.code(500).send({
        error: 'delete_error',
        message: 'Failed to delete file',
      });
    }
  }
);

// ============================================================================
// Lifecycle
// ============================================================================

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down...');
  await sftpService.close();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const start = async () => {
  try {
    // Test SFTP connection
    const sftpHealthy = await sftpService.healthCheck();
    if (sftpHealthy) {
      fastify.log.info('SFTP connection established');
    } else {
      fastify.log.warn('SFTP connection failed - will retry on first request');
    }

    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    fastify.log.info(`File Storage API running on port ${config.server.port}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

start();

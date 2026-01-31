/**
 * File Routes
 * Handles file upload, download, list, delete, and sharing.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { fileService } from '../services/file.service.js';
import { authenticate, requireUser } from '../middlewares/auth.middleware.js';

// Request schemas
const shareSchema = z.object({
  userId: z.string().uuid(),
  permission: z.enum(['read', 'write', 'delete', 'share']),
  expiresAt: z.string().datetime().optional(),
});

const revokeSchema = z.object({
  userId: z.string().uuid(),
  permission: z.enum(['read', 'write', 'delete', 'share']),
});

const renameSchema = z.object({
  name: z.string().min(1).max(255),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  includeShared: z.coerce.boolean().default(true),
});

export async function fileRoutes(fastify: FastifyInstance): Promise<void> {
  // All file routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /files/upload
   * Upload a new file.
   */
  fastify.post('/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check if user has write permission (not viewer)
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Viewers cannot upload files',
      });
    }

    const data = await request.file();

    if (!data) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'No file provided',
      });
    }

    try {
      const buffer = await data.toBuffer();
      const result = await fileService.upload(
        request.user!.id,
        data.filename,
        data.mimetype,
        buffer
      );

      return reply.code(201).send(result);
    } catch (error) {
      fastify.log.error(error, 'File upload failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'File upload failed',
      });
    }
  });

  /**
   * GET /files
   * List user's files (owned and shared).
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Invalid query parameters',
      });
    }

    try {
      const result = await fileService.listFiles(request.user!.id, {
        page: query.data.page,
        limit: query.data.limit,
        includeShared: query.data.includeShared,
      });

      // Convert BigInt to number for JSON serialization
      const files = result.files.map((file) => ({
        ...file,
        originalSize: Number(file.originalSize),
        encryptedSize: Number(file.encryptedSize),
      }));

      return reply.send({
        files,
        total: result.total,
        page: query.data.page,
        limit: query.data.limit,
        totalPages: Math.ceil(result.total / query.data.limit),
      });
    } catch (error) {
      fastify.log.error(error, 'List files failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Failed to list files',
      });
    }
  });

  /**
   * GET /files/:id
   * Get file metadata.
   */
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      const file = await fileService.getFileWithAccessCheck(request.user!.id, id);

      if (!file) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found',
        });
      }

      if (!file.hasAccess) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Access denied',
        });
      }

      return reply.send({
        id: file.id,
        originalName: file.originalName,
        originalSize: Number(file.originalSize),
        mimeType: file.mimeType,
        createdAt: file.createdAt,
        ownerId: file.ownerId,
        permission: file.permission,
      });
    } catch (error) {
      fastify.log.error(error, 'Get file failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Failed to get file',
      });
    }
  });

  /**
   * GET /files/:id/download
   * Download a file.
   */
  fastify.get('/:id/download', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      const result = await fileService.download(request.user!.id, id);

      reply.header('Content-Type', result.mimeType || 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(result.fileName)}"`);
      reply.header('Content-Length', result.data.length);

      return reply.send(result.data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage === 'File not found') {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found',
        });
      }

      if (errorMessage === 'Access denied') {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Access denied',
        });
      }

      if (errorMessage === 'File integrity check failed') {
        return reply.code(500).send({
          error: 'integrity_error',
          message: 'File integrity verification failed',
        });
      }

      fastify.log.error(error, 'File download failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'File download failed',
      });
    }
  });

  /**
   * DELETE /files/:id
   * Soft delete a file.
   */
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if user has write permission
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Viewers cannot delete files',
      });
    }

    try {
      await fileService.delete(request.user!.id, id);
      return reply.code(204).send();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('not found')) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found or access denied',
        });
      }

      fastify.log.error(error, 'File delete failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'File delete failed',
      });
    }
  });

  /**
   * DELETE /files/:id/permanent
   * Permanently delete a file.
   */
  fastify.delete('/:id/permanent', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if user has write permission
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Viewers cannot delete files',
      });
    }

    try {
      await fileService.permanentDelete(request.user!.id, id);
      return reply.code(204).send();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('not found')) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found or access denied',
        });
      }

      fastify.log.error(error, 'Permanent delete failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Permanent delete failed',
      });
    }
  });

  /**
   * PATCH /files/:id/rename
   * Rename a file.
   */
  fastify.patch('/:id/rename', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if user has write permission
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Viewers cannot rename files',
      });
    }

    const body = renameSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Invalid request body',
      });
    }

    try {
      const file = await fileService.rename(request.user!.id, id, body.data.name);

      return reply.send({
        id: file.id,
        originalName: file.originalName,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('not found')) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found or access denied',
        });
      }

      fastify.log.error(error, 'Rename failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Rename failed',
      });
    }
  });

  /**
   * POST /files/:id/share
   * Share a file with another user.
   */
  fastify.post('/:id/share', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if user has write permission
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Viewers cannot share files',
      });
    }

    const body = shareSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Invalid request body',
        details: body.error.issues,
      });
    }

    try {
      await fileService.shareFile(
        request.user!.id,
        id,
        body.data.userId,
        body.data.permission,
        body.data.expiresAt ? new Date(body.data.expiresAt) : undefined
      );

      return reply.send({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('not found')) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found or access denied',
        });
      }

      fastify.log.error(error, 'Share failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Share failed',
      });
    }
  });

  /**
   * DELETE /files/:id/share
   * Revoke a file permission.
   */
  fastify.delete('/:id/share', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if user has write permission
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Viewers cannot manage file permissions',
      });
    }

    const body = revokeSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Invalid request body',
      });
    }

    try {
      await fileService.revokePermission(
        request.user!.id,
        id,
        body.data.userId,
        body.data.permission
      );

      return reply.send({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('not found')) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'File not found or access denied',
        });
      }

      fastify.log.error(error, 'Revoke permission failed');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Revoke permission failed',
      });
    }
  });
}

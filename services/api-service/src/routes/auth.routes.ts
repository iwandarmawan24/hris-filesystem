/**
 * Authentication Routes
 * Handles login, logout, token refresh, and user management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { prisma } from '../db.js';
import { config } from '../config.js';

/**
 * Parse JWT expiration string (e.g., "24h", "15m", "7d") to seconds.
 */
function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 86400; // Default 24 hours

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 86400;
  }
}

// Request schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(255),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /auth/login
   * Authenticate user and return tokens.
   */
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Invalid request body',
        details: body.error.issues,
      });
    }

    const { email, password } = body.data;
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    // Find user
    const user = await authService.findUserByEmail(email);

    if (!user) {
      await authService.createAuditLog({
        userEmail: email,
        action: 'login_failed',
        ipAddress,
        userAgent,
        details: { reason: 'user_not_found' },
      });

      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Check if user is active
    if (!user.isActive) {
      await authService.createAuditLog({
        userId: user.id,
        userEmail: email,
        action: 'login_failed',
        ipAddress,
        userAgent,
        details: { reason: 'user_inactive' },
      });

      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Account is disabled',
      });
    }

    // Verify password
    const isValid = await authService.verifyPassword(password, user.passwordHash);

    if (!isValid) {
      await authService.createAuditLog({
        userId: user.id,
        userEmail: email,
        action: 'login_failed',
        ipAddress,
        userAgent,
        details: { reason: 'invalid_password' },
      });

      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Generate tokens
    const accessToken = fastify.jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      { expiresIn: config.jwt.expiresIn }
    );

    const refreshToken = authService.generateRefreshToken();

    // Create session
    await authService.createSession(user.id, refreshToken, ipAddress, userAgent);

    // Update last login
    await authService.updateLastLogin(user.id);

    // Create audit log
    await authService.createAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: 'login',
      ipAddress,
      userAgent,
    });

    return reply.send({
      accessToken,
      refreshToken,
      expiresIn: parseExpiresIn(config.jwt.expiresIn),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  });

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token.
   */
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = refreshSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Invalid request body',
      });
    }

    const { refreshToken } = body.data;

    // Validate refresh token
    const session = await authService.validateRefreshToken(refreshToken);

    if (!session) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    // Get user
    const user = await authService.findUserById(session.userId);

    if (!user || !user.isActive) {
      await authService.revokeSession(session.sessionId);
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'User not found or inactive',
      });
    }

    // Generate new access token
    const accessToken = fastify.jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      { expiresIn: config.jwt.expiresIn }
    );

    return reply.send({
      accessToken,
      expiresIn: parseExpiresIn(config.jwt.expiresIn),
    });
  });

  /**
   * POST /auth/logout
   * Invalidate current session.
   */
  fastify.post(
    '/logout',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = refreshSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'Refresh token required',
        });
      }

      const { refreshToken } = body.data;
      const session = await authService.validateRefreshToken(refreshToken);

      if (session) {
        await authService.revokeSession(session.sessionId);
      }

      // Create audit log
      await authService.createAuditLog({
        userId: request.user!.id,
        userEmail: request.user!.email,
        action: 'logout',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({ success: true });
    }
  );

  /**
   * POST /auth/logout-all
   * Invalidate all sessions for user.
   */
  fastify.post(
    '/logout-all',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await authService.revokeAllSessions(request.user!.id);

      return reply.send({ success: true });
    }
  );

  /**
   * GET /auth/me
   * Get current user profile.
   */
  fastify.get(
    '/me',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user!.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });

      if (!user) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'User not found',
        });
      }

      return reply.send(user);
    }
  );

  /**
   * POST /auth/register (Admin only)
   * Create a new user account.
   */
  fastify.post(
    '/register',
    { preHandler: [authenticate, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = registerSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'Invalid request body',
          details: body.error.issues,
        });
      }

      const { email, password, name } = body.data;

      // Check if email already exists
      const existing = await authService.findUserByEmail(email);

      if (existing) {
        return reply.code(409).send({
          error: 'conflict',
          message: 'Email already registered',
        });
      }

      // Hash password
      const passwordHash = await authService.hashPassword(password);

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          role: 'user',
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });

      return reply.code(201).send(user);
    }
  );

  /**
   * GET /auth/users (Admin only)
   * List all users.
   */
  fastify.get(
    '/users',
    { preHandler: [authenticate, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send(users);
    }
  );
}

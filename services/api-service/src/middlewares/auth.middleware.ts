/**
 * Authentication Middleware
 * Verifies JWT tokens and attaches user info to request.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Middleware to verify JWT token and attach user to request.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Verify JWT token (fastify-jwt adds this method)
    const decoded = await request.jwtVerify<{
      userId: string;
      email: string;
      role: string;
    }>();

    // Check if user still exists and is active
    const user = await prisma.user.findFirst({
      where: {
        id: decoded.userId,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'User not found or inactive',
      });
    }

    // Attach user to request
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  } catch (error) {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

/**
 * Middleware to check if user has admin role.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.user?.role !== 'admin') {
    return reply.code(403).send({
      error: 'forbidden',
      message: 'Admin access required',
    });
  }
}

/**
 * Middleware to check if user has at least user role (not viewer).
 */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.user?.role === 'viewer') {
    return reply.code(403).send({
      error: 'forbidden',
      message: 'User access required',
    });
  }
}

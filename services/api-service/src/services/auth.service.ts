/**
 * Authentication Service
 * Handles user authentication, JWT tokens, and sessions.
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import type { User } from '@prisma/client';

const SALT_ROUNDS = 12;

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

class AuthService {
  /**
   * Hash a password using bcrypt.
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify a password against a hash.
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a random refresh token.
   */
  generateRefreshToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a refresh token for storage.
   */
  hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Find user by email.
   */
  async findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Find user by ID.
   */
  async findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  /**
   * Create a new session.
   */
  async createSession(
    userId: string,
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    // Parse expiry from config (e.g., "7d" -> 7 days)
    const expiryMatch = config.jwt.refreshExpiresIn.match(/^(\d+)([dhms])$/);
    let expiresAt = new Date();

    if (expiryMatch) {
      const value = parseInt(expiryMatch[1]);
      const unit = expiryMatch[2];

      switch (unit) {
        case 'd':
          expiresAt.setDate(expiresAt.getDate() + value);
          break;
        case 'h':
          expiresAt.setHours(expiresAt.getHours() + value);
          break;
        case 'm':
          expiresAt.setMinutes(expiresAt.getMinutes() + value);
          break;
        case 's':
          expiresAt.setSeconds(expiresAt.getSeconds() + value);
          break;
      }
    } else {
      // Default to 7 days
      expiresAt.setDate(expiresAt.getDate() + 7);
    }

    await prisma.session.create({
      data: {
        userId,
        refreshTokenHash,
        ipAddress,
        userAgent,
        expiresAt,
      },
    });
  }

  /**
   * Validate a refresh token and return the session.
   */
  async validateRefreshToken(refreshToken: string): Promise<{
    userId: string;
    sessionId: string;
  } | null> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    const session = await prisma.session.findFirst({
      where: {
        refreshTokenHash,
        isValid: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      return null;
    }

    return {
      userId: session.userId,
      sessionId: session.id,
    };
  }

  /**
   * Revoke a session.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        isValid: false,
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Revoke all sessions for a user.
   */
  async revokeAllSessions(userId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, isValid: true },
      data: {
        isValid: false,
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Update user's last login timestamp.
   */
  async updateLastLogin(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  /**
   * Create audit log entry.
   */
  async createAuditLog(params: {
    userId?: string;
    userEmail?: string;
    action: 'login' | 'logout' | 'login_failed';
    ipAddress?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        userEmail: params.userEmail,
        action: params.action,
        resourceType: 'user',
        resourceId: params.userId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: params.details,
      },
    });
  }
}

// Singleton instance
export const authService = new AuthService();

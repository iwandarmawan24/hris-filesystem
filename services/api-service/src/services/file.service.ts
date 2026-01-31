/**
 * File Service
 * Orchestrates file operations: upload, download, delete.
 * Coordinates between encryption-service, storage-service, and database.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../db.js';
import { encryptionService } from './encryption.service.js';
import { storageService } from './storage.service.js';
import type { File, User } from '@prisma/client';

export interface UploadResult {
  id: string;
  originalName: string;
  size: number;
  mimeType: string | null;
  createdAt: Date;
}

export interface FileWithPermission extends File {
  hasAccess: boolean;
  permission?: string;
}

class FileService {
  /**
   * Upload a new file.
   *
   * Flow:
   * 1. Generate UUID for file
   * 2. Encrypt file data via encryption-service
   * 3. Store encrypted blob via storage-service
   * 4. Save metadata to database
   */
  async upload(
    userId: string,
    fileName: string,
    mimeType: string | null,
    data: Buffer
  ): Promise<UploadResult> {
    const fileId = randomUUID();
    const storagePath = `${fileId}.enc`;

    // Step 1: Encrypt the file
    const encrypted = await encryptionService.encrypt(data);

    // Step 2: Store encrypted blob
    await storageService.store(fileId, encrypted.encryptedData);

    // Step 3: Save metadata to database
    const file = await prisma.file.create({
      data: {
        id: fileId,
        originalName: fileName,
        originalSize: BigInt(data.length),
        mimeType,
        storagePath,
        encryptedSize: BigInt(encrypted.encryptedData.length),
        checksumOriginal: encrypted.checksumOriginal,
        checksumEncrypted: encrypted.checksumEncrypted,
        encryptedDek: encrypted.wrappedDek,
        vaultKeyVersion: encrypted.vaultKeyVersion,
        encryptionIv: encrypted.nonce,
        ownerId: userId,
      },
    });

    // Step 4: Create audit log
    await this.createAuditLog(userId, 'file_upload', fileId, {
      fileName,
      size: data.length,
    });

    return {
      id: file.id,
      originalName: file.originalName,
      size: Number(file.originalSize),
      mimeType: file.mimeType,
      createdAt: file.createdAt,
    };
  }

  /**
   * Download a file.
   *
   * Flow:
   * 1. Check access permission
   * 2. Get metadata from database
   * 3. Retrieve encrypted blob from storage
   * 4. Decrypt via encryption-service
   * 5. Verify checksum
   */
  async download(
    userId: string,
    fileId: string
  ): Promise<{ data: Buffer; fileName: string; mimeType: string | null }> {
    // Step 1: Get file metadata and check access
    const file = await this.getFileWithAccessCheck(userId, fileId);

    if (!file) {
      throw new Error('File not found');
    }

    if (!file.hasAccess) {
      throw new Error('Access denied');
    }

    // Step 2: Retrieve encrypted blob
    const encryptedData = await storageService.retrieve(file.id);

    // Step 3: Decrypt
    const decrypted = await encryptionService.decrypt(
      encryptedData,
      file.encryptedDek,
      file.encryptionIv!,
      file.checksumOriginal
    );

    // Step 4: Verify checksum
    if (!decrypted.checksumVerified) {
      throw new Error('File integrity check failed');
    }

    // Step 5: Create audit log
    await this.createAuditLog(userId, 'file_download', fileId);

    return {
      data: decrypted.decryptedData,
      fileName: file.originalName,
      mimeType: file.mimeType,
    };
  }

  /**
   * Delete a file (soft delete).
   */
  async delete(userId: string, fileId: string): Promise<void> {
    // Check ownership (only owner can delete)
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        ownerId: userId,
        deletedAt: null,
      },
    });

    if (!file) {
      throw new Error('File not found or access denied');
    }

    // Soft delete in database
    await prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    // Optionally delete from storage (or keep for retention)
    // await storageService.delete(fileId);

    // Create audit log
    await this.createAuditLog(userId, 'file_delete', fileId);
  }

  /**
   * Permanently delete a file (hard delete).
   */
  async permanentDelete(userId: string, fileId: string): Promise<void> {
    // Check ownership
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        ownerId: userId,
      },
    });

    if (!file) {
      throw new Error('File not found or access denied');
    }

    // Delete from storage
    await storageService.delete(fileId);

    // Delete from database (cascade deletes permissions)
    await prisma.file.delete({
      where: { id: fileId },
    });
  }

  /**
   * Rename a file (update metadata).
   */
  async rename(userId: string, fileId: string, newName: string): Promise<File> {
    // Check ownership
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        ownerId: userId,
        deletedAt: null,
      },
    });

    if (!file) {
      throw new Error('File not found or access denied');
    }

    return prisma.file.update({
      where: { id: fileId },
      data: { originalName: newName },
    });
  }

  /**
   * List files for a user (owned + shared).
   */
  async listFiles(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      includeShared?: boolean;
    } = {}
  ): Promise<{ files: File[]; total: number }> {
    const { page = 1, limit = 50, includeShared = true } = options;
    const skip = (page - 1) * limit;

    // Build where clause
    const whereClause = includeShared
      ? {
          OR: [
            { ownerId: userId, deletedAt: null },
            {
              permissions: {
                some: {
                  userId,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
              },
              deletedAt: null,
            },
          ],
        }
      : { ownerId: userId, deletedAt: null };

    const [files, total] = await Promise.all([
      prisma.file.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.file.count({ where: whereClause }),
    ]);

    return { files, total };
  }

  /**
   * Get file with access check.
   */
  async getFileWithAccessCheck(
    userId: string,
    fileId: string
  ): Promise<FileWithPermission | null> {
    const file = await prisma.file.findFirst({
      where: { id: fileId, deletedAt: null },
      include: {
        permissions: {
          where: {
            userId,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        },
      },
    });

    if (!file) {
      return null;
    }

    const isOwner = file.ownerId === userId;
    const hasPermission = file.permissions.length > 0;

    return {
      ...file,
      hasAccess: isOwner || hasPermission,
      permission: isOwner ? 'owner' : file.permissions[0]?.permission,
    };
  }

  /**
   * Share file with another user.
   */
  async shareFile(
    ownerId: string,
    fileId: string,
    targetUserId: string,
    permission: 'read' | 'write' | 'delete' | 'share',
    expiresAt?: Date
  ): Promise<void> {
    // Check ownership
    const file = await prisma.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: null },
    });

    if (!file) {
      throw new Error('File not found or access denied');
    }

    // Create permission
    await prisma.filePermission.upsert({
      where: {
        unique_file_user_permission: {
          fileId,
          userId: targetUserId,
          permission,
        },
      },
      create: {
        fileId,
        userId: targetUserId,
        permission,
        grantedBy: ownerId,
        expiresAt,
      },
      update: {
        grantedBy: ownerId,
        grantedAt: new Date(),
        expiresAt,
      },
    });

    // Create audit log
    await this.createAuditLog(ownerId, 'file_share', fileId, {
      targetUserId,
      permission,
    });
  }

  /**
   * Revoke file permission.
   */
  async revokePermission(
    ownerId: string,
    fileId: string,
    targetUserId: string,
    permission: 'read' | 'write' | 'delete' | 'share'
  ): Promise<void> {
    // Check ownership
    const file = await prisma.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: null },
    });

    if (!file) {
      throw new Error('File not found or access denied');
    }

    await prisma.filePermission.deleteMany({
      where: { fileId, userId: targetUserId, permission },
    });

    // Create audit log
    await this.createAuditLog(ownerId, 'permission_revoke', fileId, {
      targetUserId,
      permission,
    });
  }

  /**
   * Create audit log entry.
   */
  private async createAuditLog(
    userId: string,
    action: 'file_upload' | 'file_download' | 'file_delete' | 'file_share' | 'permission_revoke',
    fileId: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        userEmail: user?.email,
        action,
        resourceType: 'file',
        resourceId: fileId,
        details,
      },
    });
  }
}

// Singleton instance
export const fileService = new FileService();

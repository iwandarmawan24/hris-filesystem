/**
 * SFTP Client Service
 * Handles connection pooling and file operations via SFTP.
 */

import SftpClient from 'ssh2-sftp-client';
import { createHash } from 'crypto';
import { config } from './config.js';

class SftpService {
  private client: SftpClient | null = null;
  private connecting = false;
  private connectionPromise: Promise<SftpClient> | null = null;

  /**
   * Get or create SFTP connection.
   */
  private async getClient(): Promise<SftpClient> {
    if (this.client) {
      return this.client;
    }

    if (this.connecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connecting = true;
    this.connectionPromise = this.connect();

    try {
      this.client = await this.connectionPromise;
      return this.client;
    } finally {
      this.connecting = false;
      this.connectionPromise = null;
    }
  }

  /**
   * Create new SFTP connection.
   */
  private async connect(): Promise<SftpClient> {
    const client = new SftpClient();

    await client.connect({
      host: config.sftp.host,
      port: config.sftp.port,
      username: config.sftp.username,
      privateKey: config.sftp.privateKey,
      readyTimeout: 10000,
      retries: 3,
      retry_minTimeout: 1000,
    });

    // Ensure base path exists
    const basePath = config.sftp.basePath;
    const exists = await client.exists(basePath);
    if (!exists) {
      await client.mkdir(basePath, true);
    }

    return client;
  }

  /**
   * Get file path for UUID (with subdirectory distribution).
   */
  private getFilePath(uuid: string): string {
    const subdir = uuid.substring(0, 2);
    return `${config.sftp.basePath}/${subdir}/${uuid}.enc`;
  }

  /**
   * Get subdirectory path for UUID.
   */
  private getSubdirPath(uuid: string): string {
    const subdir = uuid.substring(0, 2);
    return `${config.sftp.basePath}/${subdir}`;
  }

  /**
   * Store encrypted file.
   */
  async store(uuid: string, data: Buffer): Promise<{ path: string; checksum: string }> {
    const client = await this.getClient();
    const filePath = this.getFilePath(uuid);
    const subdirPath = this.getSubdirPath(uuid);

    // Ensure subdirectory exists
    const subdirExists = await client.exists(subdirPath);
    if (!subdirExists) {
      await client.mkdir(subdirPath, true);
    }

    // Calculate checksum
    const checksum = createHash('sha256').update(data).digest('hex');

    // Upload file
    await client.put(data, filePath);

    return {
      path: filePath,
      checksum,
    };
  }

  /**
   * Retrieve encrypted file.
   */
  async retrieve(uuid: string): Promise<Buffer> {
    const client = await this.getClient();
    const filePath = this.getFilePath(uuid);

    // Check if file exists
    const exists = await client.exists(filePath);
    if (!exists) {
      throw new Error('File not found');
    }

    // Download file
    const data = await client.get(filePath);

    if (typeof data === 'string') {
      return Buffer.from(data);
    }

    return data as Buffer;
  }

  /**
   * Check if file exists.
   */
  async exists(uuid: string): Promise<boolean> {
    const client = await this.getClient();
    const filePath = this.getFilePath(uuid);
    const result = await client.exists(filePath);
    return result !== false;
  }

  /**
   * Get file stats.
   */
  async stat(uuid: string): Promise<{ size: number; modifyTime: number } | null> {
    const client = await this.getClient();
    const filePath = this.getFilePath(uuid);

    try {
      const stats = await client.stat(filePath);
      return {
        size: stats.size,
        modifyTime: stats.modifyTime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete file.
   */
  async delete(uuid: string): Promise<boolean> {
    const client = await this.getClient();
    const filePath = this.getFilePath(uuid);

    const exists = await client.exists(filePath);
    if (!exists) {
      return false;
    }

    await client.delete(filePath);

    // Try to remove empty subdirectory
    try {
      const subdirPath = this.getSubdirPath(uuid);
      const files = await client.list(subdirPath);
      if (files.length === 0) {
        await client.rmdir(subdirPath);
      }
    } catch {
      // Ignore errors when removing subdirectory
    }

    return true;
  }

  /**
   * Check SFTP connection health.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.list(config.sftp.basePath);
      return true;
    } catch {
      // Reset connection on failure
      this.client = null;
      return false;
    }
  }

  /**
   * Close SFTP connection.
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}

// Singleton instance
export const sftpService = new SftpService();

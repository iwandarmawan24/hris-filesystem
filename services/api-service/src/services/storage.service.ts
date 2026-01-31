/**
 * File Storage Service Client
 * Communicates with file-storage-api for storing/retrieving encrypted blobs.
 */

import { config } from '../config.js';

interface StorageResponse {
  success: boolean;
  path: string;
  checksum: string;
}

class StorageService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.services.fileStorageUrl;
    this.apiKey = process.env.FILE_STORAGE_API_KEY ?? '';
  }

  private getHeaders(): HeadersInit {
    return {
      'X-API-Key': this.apiKey,
    };
  }

  /**
   * Store encrypted file blob.
   * @param uuid - File UUID (will be used as filename)
   * @param data - Encrypted file buffer
   * @returns Storage path and checksum
   */
  async store(uuid: string, data: Buffer): Promise<{ path: string; checksum: string }> {
    const response = await fetch(`${this.baseUrl}/files/${uuid}`, {
      method: 'PUT',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Storage failed: ${error}`);
    }

    const result: StorageResponse = await response.json();

    return {
      path: result.path,
      checksum: result.checksum,
    };
  }

  /**
   * Retrieve encrypted file blob.
   * @param uuid - File UUID
   * @returns Encrypted file buffer
   */
  async retrieve(uuid: string): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/files/${uuid}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('File not found in storage');
      }
      const error = await response.text();
      throw new Error(`Storage retrieval failed: ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Delete encrypted file blob.
   * @param uuid - File UUID
   */
  async delete(uuid: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/files/${uuid}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`Storage deletion failed: ${error}`);
    }
  }

  /**
   * Check if file exists in storage.
   * @param uuid - File UUID
   */
  async exists(uuid: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/files/${uuid}`, {
      method: 'HEAD',
      headers: this.getHeaders(),
    });

    return response.ok;
  }

  /**
   * Check storage service health.
   */
  async healthCheck(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/health`);

    if (!response.ok) {
      throw new Error('Storage service health check failed');
    }

    return response.json();
  }
}

// Singleton instance
export const storageService = new StorageService();

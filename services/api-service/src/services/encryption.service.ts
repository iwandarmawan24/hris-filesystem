/**
 * Encryption Service Client
 * Communicates with the Python encryption-service for file encryption/decryption.
 */

import { config } from '../config.js';

interface EncryptResponse {
  encrypted_data: string; // base64
  wrapped_dek: string;
  nonce: string; // base64
  vault_key_version: number;
  checksum_original: string;
  checksum_encrypted: string;
}

interface DecryptResponse {
  decrypted_data: string; // base64
  checksum: string;
  checksum_verified: boolean;
}

interface HealthResponse {
  status: string;
  vault_connected: boolean;
  version: string;
}

class EncryptionService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.services.encryptionUrl;
  }

  /**
   * Encrypt file data.
   * @param data - Raw file buffer
   * @returns Encrypted data and metadata for storage
   */
  async encrypt(data: Buffer): Promise<{
    encryptedData: Buffer;
    wrappedDek: string;
    nonce: string;
    vaultKeyVersion: number;
    checksumOriginal: string;
    checksumEncrypted: string;
  }> {
    const response = await fetch(`${this.baseUrl}/api/v1/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: data.toString('base64'),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Encryption failed: ${error}`);
    }

    const result: EncryptResponse = await response.json();

    return {
      encryptedData: Buffer.from(result.encrypted_data, 'base64'),
      wrappedDek: result.wrapped_dek,
      nonce: result.nonce,
      vaultKeyVersion: result.vault_key_version,
      checksumOriginal: result.checksum_original,
      checksumEncrypted: result.checksum_encrypted,
    };
  }

  /**
   * Decrypt file data.
   * @param encryptedData - Encrypted file buffer
   * @param wrappedDek - Vault-encrypted DEK from database
   * @param nonce - Nonce/IV from database
   * @param expectedChecksum - Optional checksum for verification
   * @returns Decrypted data
   */
  async decrypt(
    encryptedData: Buffer,
    wrappedDek: string,
    nonce: string,
    expectedChecksum?: string
  ): Promise<{
    decryptedData: Buffer;
    checksum: string;
    checksumVerified: boolean;
  }> {
    const response = await fetch(`${this.baseUrl}/api/v1/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encrypted_data: encryptedData.toString('base64'),
        wrapped_dek: wrappedDek,
        nonce: nonce,
        expected_checksum: expectedChecksum,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Decryption failed: ${error}`);
    }

    const result: DecryptResponse = await response.json();

    return {
      decryptedData: Buffer.from(result.decrypted_data, 'base64'),
      checksum: result.checksum,
      checksumVerified: result.checksum_verified,
    };
  }

  /**
   * Check encryption service health.
   */
  async healthCheck(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/health`);

    if (!response.ok) {
      throw new Error('Encryption service health check failed');
    }

    return response.json();
  }
}

// Singleton instance
export const encryptionService = new EncryptionService();

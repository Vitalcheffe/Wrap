/**
 * WRAP NEBULA v2.0 - Secrets Manager
 * Secure secrets management with multiple providers
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SecretsInterface, SecretsConfig, SecretsProvider, WrapError } from '../types';

// ============================================================================
// Types
// ============================================================================

interface SecretEntry {
  key: string;
  value: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

interface CacheEntry {
  value: string;
  timestamp: number;
}

// ============================================================================
// Secrets Manager Implementation
// ============================================================================

export class SecretsManager implements SecretsInterface {
  private providers: SecretsProvider[] = [];
  private cache: Map<string, CacheEntry> = new Map();
  private config: { cache: boolean; cacheTTL: number };
  private encryptionKey: Buffer | null = null;

  constructor(config: Partial<SecretsConfig> = {}) {
    this.config = {
      cache: config.cache ?? true,
      cacheTTL: config.cacheTTL ?? 300000, // 5 minutes
    };

    if (config.providers) {
      this.providers = config.providers;
    } else {
      // Default providers
      this.providers = [
        { type: 'env' },
      ];
    }

    // Generate encryption key for memory storage
    this.encryptionKey = crypto.randomBytes(32);
  }

  /**
   * Initialize secrets manager
   */
  async initialize(): Promise<void> {
    // Validate providers
    for (const provider of this.providers) {
      await this.validateProvider(provider);
    }
  }

  /**
   * Validate provider
   */
  private async validateProvider(provider: SecretsProvider): Promise<void> {
    switch (provider.type) {
      case 'file':
        if (provider.path) {
          try {
            await fs.promises.access(provider.path, fs.constants.R_OK);
          } catch {
            // Create file if doesn't exist
            await fs.promises.mkdir(path.dirname(provider.path), { recursive: true });
            await fs.promises.writeFile(provider.path, '{}');
          }
        }
        break;

      case 'vault':
        // Vault connection would be validated here
        break;

      case 'env':
        // Always available
        break;
    }
  }

  /**
   * Get secret value
   */
  async get(key: string): Promise<string> {
    // Check cache
    if (this.config.cache) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.value;
      }
    }

    // Try providers in order
    for (const provider of this.providers) {
      const value = await this.getFromProvider(key, provider);
      if (value !== null) {
        // Cache the value
        if (this.config.cache) {
          this.cache.set(key, { value, timestamp: Date.now() });
        }
        return value;
      }
    }

    throw new WrapError(`Secret not found: ${key}`, 'SECRET_NOT_FOUND');
  }

  /**
   * Set secret value
   */
  async set(key: string, value: string): Promise<void> {
    // Store in first writable provider
    let stored = false;

    for (const provider of this.providers) {
      if (await this.setToProvider(key, value, provider)) {
        stored = true;
        break;
      }
    }

    if (!stored) {
      throw new WrapError('No writable secrets provider available', 'NO_WRITABLE_PROVIDER');
    }

    // Update cache
    if (this.config.cache) {
      this.cache.set(key, { value, timestamp: Date.now() });
    }
  }

  /**
   * Delete secret
   */
  async delete(key: string): Promise<void> {
    // Delete from all providers
    for (const provider of this.providers) {
      await this.deleteFromProvider(key, provider);
    }

    // Remove from cache
    this.cache.delete(key);
  }

  /**
   * List all secrets
   */
  async list(): Promise<string[]> {
    const keys = new Set<string>();

    for (const provider of this.providers) {
      const providerKeys = await this.listFromProvider(provider);
      for (const key of providerKeys) {
        keys.add(key);
      }
    }

    return Array.from(keys);
  }

  // ==========================================================================
  // Provider Methods
  // ==========================================================================

  /**
   * Get from provider
   */
  private async getFromProvider(key: string, provider: SecretsProvider): Promise<string | null> {
    switch (provider.type) {
      case 'env':
        return this.getFromEnv(key, provider.prefix);

      case 'file':
        return this.getFromFile(key, provider.path);

      case 'vault':
        return this.getFromVault(key, provider);

      default:
        return null;
    }
  }

  /**
   * Set to provider
   */
  private async setToProvider(key: string, value: string, provider: SecretsProvider): Promise<boolean> {
    switch (provider.type) {
      case 'env':
        // Cannot set environment variables at runtime
        return false;

      case 'file':
        return this.setToFile(key, value, provider.path);

      case 'vault':
        return this.setToVault(key, value, provider);

      default:
        return false;
    }
  }

  /**
   * Delete from provider
   */
  private async deleteFromProvider(key: string, provider: SecretsProvider): Promise<void> {
    switch (provider.type) {
      case 'env':
        // Cannot delete environment variables at runtime
        break;

      case 'file':
        await this.deleteFromFile(key, provider.path);
        break;

      case 'vault':
        await this.deleteFromVault(key, provider);
        break;
    }
  }

  /**
   * List from provider
   */
  private async listFromProvider(provider: SecretsProvider): Promise<string[]> {
    switch (provider.type) {
      case 'env':
        return this.listFromEnv(provider.prefix);

      case 'file':
        return this.listFromFile(provider.path);

      case 'vault':
        return this.listFromVault(provider);

      default:
        return [];
    }
  }

  // ==========================================================================
  // Environment Variables Provider
  // ==========================================================================

  private getFromEnv(key: string, prefix?: string): string | null {
    const envKey = prefix ? `${prefix}_${key}` : key;
    return process.env[envKey] || null;
  }

  private listFromEnv(prefix?: string): string[] {
    const keys: string[] = [];
    const envPrefix = prefix ? `${prefix}_` : '';

    for (const envKey of Object.keys(process.env)) {
      if (prefix) {
        if (envKey.startsWith(envPrefix)) {
          keys.push(envKey.slice(envPrefix.length));
        }
      } else {
        keys.push(envKey);
      }
    }

    return keys;
  }

  // ==========================================================================
  // File Provider
  // ==========================================================================

  private async getFromFile(key: string, filePath?: string): Promise<string | null> {
    if (!filePath) return null;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const secrets = JSON.parse(content);
      return secrets[key] || null;
    } catch {
      return null;
    }
  }

  private async setToFile(key: string, value: string, filePath?: string): Promise<boolean> {
    if (!filePath) return false;

    try {
      let secrets: Record<string, string> = {};

      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        secrets = JSON.parse(content);
      } catch {
        // File doesn't exist or is empty
      }

      secrets[key] = value;
      await fs.promises.writeFile(filePath, JSON.stringify(secrets, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  private async deleteFromFile(key: string, filePath?: string): Promise<void> {
    if (!filePath) return;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const secrets = JSON.parse(content);
      delete secrets[key];
      await fs.promises.writeFile(filePath, JSON.stringify(secrets, null, 2));
    } catch {
      // Ignore errors
    }
  }

  private async listFromFile(filePath?: string): Promise<string[]> {
    if (!filePath) return [];

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const secrets = JSON.parse(content);
      return Object.keys(secrets);
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Vault Provider (Stub - requires vault client)
  // ==========================================================================

  private async getFromVault(key: string, provider: { address: string; path: string; token?: string }): Promise<string | null> {
    // In production, this would use the Vault HTTP API
    // For now, return null
    try {
      const response = await fetch(`${provider.address}/v1/${provider.path}/${key}`, {
        headers: {
          'X-Vault-Token': provider.token || '',
        },
      });

      if (response.ok) {
        const data = await response.json() as { data?: { value?: string } };
        return data.data?.value || null;
      }
    } catch {
      // Vault not available
    }

    return null;
  }

  private async setToVault(key: string, value: string, provider: { address: string; path: string; token?: string }): Promise<boolean> {
    try {
      const response = await fetch(`${provider.address}/v1/${provider.path}/${key}`, {
        method: 'POST',
        headers: {
          'X-Vault-Token': provider.token || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { value } }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  private async deleteFromVault(key: string, provider: { address: string; path: string; token?: string }): Promise<void> {
    try {
      await fetch(`${provider.address}/v1/${provider.path}/${key}`, {
        method: 'DELETE',
        headers: {
          'X-Vault-Token': provider.token || '',
        },
      });
    } catch {
      // Ignore errors
    }
  }

  private async listFromVault(provider: { address: string; path: string; token?: string }): Promise<string[]> {
    try {
      const response = await fetch(`${provider.address}/v1/${provider.path}?list=true`, {
        headers: {
          'X-Vault-Token': provider.token || '',
        },
      });

      if (response.ok) {
        const data = await response.json() as { data?: { keys?: string[] } };
        return data.data?.keys || [];
      }
    } catch {
      // Vault not available
    }

    return [];
  }

  // ==========================================================================
  // Additional Methods
  // ==========================================================================

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Add provider
   */
  addProvider(provider: SecretsProvider): void {
    this.providers.push(provider);
  }

  /**
   * Check if secret exists
   */
  async has(key: string): Promise<boolean> {
    try {
      await this.get(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get multiple secrets
   */
  async getMultiple(keys: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const key of keys) {
      try {
        result[key] = await this.get(key);
      } catch {
        // Skip missing secrets
      }
    }

    return result;
  }
}

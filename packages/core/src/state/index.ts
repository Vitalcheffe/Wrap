/**
 * WRAP NEBULA v2.0 - State Manager
 * Persistent state management for agents and conversations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StateConfig, StateEntry, WrapError } from '../types';

// ============================================================================
// Types
// ============================================================================

interface StateStore {
  [key: string]: StateEntry;
}

interface StateSnapshot {
  id: string;
  timestamp: number;
  data: StateStore;
}

// ============================================================================
// State Manager Implementation
// ============================================================================

export class StateManager {
  private config: StateConfig;
  private store: StateStore = {};
  private initialized: boolean = false;
  private filePath: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<StateConfig> = {}) {
    this.config = {
      backend: config.backend || 'memory',
      path: config.path,
      ttl: config.ttl,
      maxSize: config.maxSize || 100 * 1024 * 1024, // 100MB
      ...config,
    };
  }

  /**
   * Initialize state manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    switch (this.config.backend) {
      case 'file':
        await this.initializeFileBackend();
        break;

      case 'database':
        await this.initializeDatabaseBackend();
        break;

      case 'redis':
        await this.initializeRedisBackend();
        break;

      case 'memory':
      default:
        // No initialization needed for memory backend
        break;
    }

    // Start auto-save for file backend
    if (this.config.backend === 'file' && this.filePath) {
      this.saveTimer = setInterval(() => {
        this.saveToFile();
      }, 10000); // Save every 10 seconds
    }

    this.initialized = true;
  }

  /**
   * Initialize file backend
   */
  private async initializeFileBackend(): Promise<void> {
    this.filePath = this.config.path || './data/state.json';

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    // Load existing state
    try {
      const content = await fs.promises.readFile(this.filePath, 'utf-8');
      this.store = JSON.parse(content);
    } catch {
      // File doesn't exist, start fresh
      this.store = {};
    }
  }

  /**
   * Initialize database backend (stub)
   */
  private async initializeDatabaseBackend(): Promise<void> {
    // In production, this would connect to a database
    // For now, fall back to memory
    console.warn('Database backend not implemented, using memory');
  }

  /**
   * Initialize Redis backend (stub)
   */
  private async initializeRedisBackend(): Promise<void> {
    // In production, this would connect to Redis
    // For now, fall back to memory
    console.warn('Redis backend not implemented, using memory');
  }

  /**
   * Close state manager
   */
  async close(): Promise<void> {
    if (!this.initialized) return;

    // Stop auto-save
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    // Final save for file backend
    if (this.config.backend === 'file') {
      await this.saveToFile();
    }

    this.initialized = false;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Get value by key
   */
  async get(key: string): Promise<unknown | undefined> {
    const entry = this.store[key];

    if (!entry) {
      return undefined;
    }

    // Check TTL
    if (entry.ttl && Date.now() > entry.createdAt + entry.ttl) {
      delete this.store[key];
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set value
   */
  async set(key: string, value: unknown, options: { ttl?: number; tags?: string[] } = {}): Promise<void> {
    const now = Date.now();

    this.store[key] = {
      key,
      value,
      createdAt: this.store[key]?.createdAt || now,
      updatedAt: now,
      ttl: options.ttl || this.config.ttl,
      tags: options.tags,
    };

    // Check max size
    await this.checkMaxSize();
  }

  /**
   * Delete value
   */
  async delete(key: string): Promise<boolean> {
    if (key in this.store) {
      delete this.store[key];
      return true;
    }
    return false;
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    const entry = this.store[key];
    if (!entry) return false;

    // Check TTL
    if (entry.ttl && Date.now() > entry.createdAt + entry.ttl) {
      delete this.store[key];
      return false;
    }

    return true;
  }

  /**
   * List all keys
   */
  async keys(): Promise<string[]> {
    return Object.keys(this.store);
  }

  /**
   * Get all entries
   */
  async entries(): Promise<StateEntry[]> {
    return Object.values(this.store);
  }

  /**
   * Clear all state
   */
  async clear(): Promise<void> {
    this.store = {};
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Find by tag
   */
  async findByTag(tag: string): Promise<StateEntry[]> {
    return Object.values(this.store).filter(entry =>
      entry.tags?.includes(tag)
    );
  }

  /**
   * Find by pattern
   */
  async findByPattern(pattern: string): Promise<StateEntry[]> {
    const regex = new RegExp(pattern);
    return Object.values(this.store).filter(entry =>
      regex.test(entry.key)
    );
  }

  /**
   * Get multiple values
   */
  async getMultiple(keys: string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    for (const key of keys) {
      const value = await this.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Set multiple values
   */
  async setMultiple(entries: Record<string, unknown>, options: { ttl?: number; tags?: string[] } = {}): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value, options);
    }
  }

  // ==========================================================================
  // Snapshot Operations
  // ==========================================================================

  /**
   * Create snapshot
   */
  async createSnapshot(): Promise<StateSnapshot> {
    return {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      data: { ...this.store },
    };
  }

  /**
   * Restore from snapshot
   */
  async restoreSnapshot(snapshot: StateSnapshot): Promise<void> {
    this.store = { ...snapshot.data };
  }

  /**
   * Export state as JSON
   */
  async export(): Promise<string> {
    return JSON.stringify(this.store, null, 2);
  }

  /**
   * Import state from JSON
   */
  async import(json: string): Promise<void> {
    const data = JSON.parse(json);
    this.store = { ...this.store, ...data };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Save to file
   */
  private async saveToFile(): Promise<void> {
    if (!this.filePath) return;

    try {
      const content = JSON.stringify(this.store, null, 2);
      await fs.promises.writeFile(this.filePath, content, 'utf-8');
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  /**
   * Check max size and evict if necessary
   */
  private async checkMaxSize(): Promise<void> {
    const size = JSON.stringify(this.store).length;

    if (size > this.config.maxSize!) {
      // Evict oldest entries
      const entries = Object.values(this.store);
      entries.sort((a, b) => a.updatedAt - b.updatedAt);

      // Remove 10% of entries
      const toRemove = Math.ceil(entries.length * 0.1);
      for (let i = 0; i < toRemove; i++) {
        delete this.store[entries[i].key];
      }
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get statistics
   */
  getStats(): {
    entryCount: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Object.values(this.store);
    const totalSize = JSON.stringify(this.store).length;

    let oldest: number | null = null;
    let newest: number | null = null;

    for (const entry of entries) {
      if (oldest === null || entry.createdAt < oldest) {
        oldest = entry.createdAt;
      }
      if (newest === null || entry.createdAt > newest) {
        newest = entry.createdAt;
      }
    }

    return {
      entryCount: entries.length,
      totalSize,
      oldestEntry: oldest,
      newestEntry: newest,
    };
  }
}

/**
 * WRAP NEBULA v2.0 - Virtual File System
 * Secure file system abstraction with sandboxing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { VFSConfig, VFSEntry, VFSStats, VFSInterface, ValidationError, SecurityError } from '../types';

// ============================================================================
// Types
// ============================================================================

interface VFSFile {
  path: string;
  content: Buffer;
  created: number;
  modified: number;
  accessed: number;
  permissions: string;
}

interface VFSDirectory {
  path: string;
  created: number;
  modified: number;
  permissions: string;
}

// ============================================================================
// VFS Implementation
// ============================================================================

export class VFS implements VFSInterface {
  private config: VFSConfig;
  private files: Map<string, VFSFile> = new Map();
  private directories: Map<string, VFSDirectory> = new Map();
  private initialized: boolean = false;
  private rootPath: string;

  constructor(config: Partial<VFSConfig> = {}) {
    this.config = {
      root: '/sandbox',
      readOnlyPatterns: [],
      writeOnlyPatterns: [],
      deniedPatterns: ['**/.env', '**/secrets/**', '**/.git/**'],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxTotalSize: 100 * 1024 * 1024, // 100MB
      ...config,
    };
    this.rootPath = path.resolve(this.config.root);
  }

  /**
   * Initialize VFS
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create root directory if it doesn't exist
    try {
      await fs.promises.mkdir(this.rootPath, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Create default structure
    await this.createDefaultStructure();

    this.initialized = true;
  }

  /**
   * Create default directory structure
   */
  private async createDefaultStructure(): Promise<void> {
    const defaultDirs = [
      '/workspace',
      '/temp',
      '/output',
      '/logs',
      '/cache',
    ];

    for (const dir of defaultDirs) {
      const fullPath = path.join(this.rootPath, dir);
      try {
        await fs.promises.mkdir(fullPath, { recursive: true });
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Read a file
   */
  async read(virtualPath: string): Promise<Buffer> {
    const resolvedPath = this.resolvePath(virtualPath);
    this.checkReadAccess(resolvedPath);

    const realPath = this.toRealPath(resolvedPath);

    try {
      const content = await fs.promises.readFile(realPath);
      const stats = await fs.promises.stat(realPath);

      // Update cache
      this.files.set(resolvedPath, {
        path: resolvedPath,
        content,
        created: stats.birthtimeMs,
        modified: stats.mtimeMs,
        accessed: Date.now(),
        permissions: this.getFilePermissions(stats.mode),
      });

      return content;
    } catch (error) {
      // Check in-memory cache
      const cached = this.files.get(resolvedPath);
      if (cached) {
        cached.accessed = Date.now();
        return cached.content;
      }
      throw new ValidationError(`File not found: ${virtualPath}`);
    }
  }

  /**
   * Write a file
   */
  async write(virtualPath: string, content: Buffer | string): Promise<void> {
    const resolvedPath = this.resolvePath(virtualPath);
    this.checkWriteAccess(resolvedPath);

    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    // Check size limits
    if (buffer.length > this.config.maxFileSize) {
      throw new ValidationError(`File too large: ${buffer.length} bytes (max: ${this.config.maxFileSize})`);
    }

    const realPath = this.toRealPath(resolvedPath);

    // Ensure parent directory exists
    const parentDir = path.dirname(realPath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    // Write file
    await fs.promises.writeFile(realPath, buffer);

    // Update cache
    const now = Date.now();
    this.files.set(resolvedPath, {
      path: resolvedPath,
      content: buffer,
      created: now,
      modified: now,
      accessed: now,
      permissions: 'rw',
    });
  }

  /**
   * Delete a file
   */
  async delete(virtualPath: string): Promise<void> {
    const resolvedPath = this.resolvePath(virtualPath);
    this.checkWriteAccess(resolvedPath);

    const realPath = this.toRealPath(resolvedPath);

    try {
      await fs.promises.unlink(realPath);
      this.files.delete(resolvedPath);
    } catch {
      throw new ValidationError(`File not found: ${virtualPath}`);
    }
  }

  /**
   * List directory contents
   */
  async list(virtualPath: string): Promise<VFSEntry[]> {
    const resolvedPath = this.resolvePath(virtualPath);
    this.checkReadAccess(resolvedPath);

    const realPath = this.toRealPath(resolvedPath);
    const entries: VFSEntry[] = [];

    try {
      const files = await fs.promises.readdir(realPath, { withFileTypes: true });

      for (const file of files) {
        const filePath = path.join(resolvedPath, file.name);
        const stats = await fs.promises.stat(path.join(realPath, file.name));

        entries.push({
          name: file.name,
          path: filePath,
          type: file.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          modified: stats.mtimeMs,
          permissions: this.getFilePermissions(stats.mode),
        });
      }
    } catch (error) {
      // Return empty list if directory doesn't exist
    }

    return entries;
  }

  /**
   * Check if file exists
   */
  async exists(virtualPath: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(virtualPath);
    const realPath = this.toRealPath(resolvedPath);

    try {
      await fs.promises.access(realPath);
      return true;
    } catch {
      // Check in-memory
      return this.files.has(resolvedPath) || this.directories.has(resolvedPath);
    }
  }

  /**
   * Get file stats
   */
  async stat(virtualPath: string): Promise<VFSStats> {
    const resolvedPath = this.resolvePath(virtualPath);
    this.checkReadAccess(resolvedPath);

    const realPath = this.toRealPath(resolvedPath);

    try {
      const stats = await fs.promises.stat(realPath);

      return {
        size: stats.size,
        created: stats.birthtimeMs,
        modified: stats.mtimeMs,
        accessed: stats.atimeMs,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: this.getFilePermissions(stats.mode),
      };
    } catch {
      throw new ValidationError(`File not found: ${virtualPath}`);
    }
  }

  /**
   * Create directory
   */
  async mkdir(virtualPath: string): Promise<void> {
    const resolvedPath = this.resolvePath(virtualPath);
    this.checkWriteAccess(resolvedPath);

    const realPath = this.toRealPath(resolvedPath);
    await fs.promises.mkdir(realPath, { recursive: true });

    const now = Date.now();
    this.directories.set(resolvedPath, {
      path: resolvedPath,
      created: now,
      modified: now,
      permissions: 'rwx',
    });
  }

  /**
   * Copy file
   */
  async copy(source: string, destination: string): Promise<void> {
    const content = await this.read(source);
    await this.write(destination, content);
  }

  /**
   * Move file
   */
  async move(source: string, destination: string): Promise<void> {
    await this.copy(source, destination);
    await this.delete(source);
  }

  /**
   * Watch directory for changes
   */
  watch(virtualPath: string, callback: (event: string, filename: string) => void): fs.FSWatcher {
    const resolvedPath = this.resolvePath(virtualPath);
    const realPath = this.toRealPath(resolvedPath);

    return fs.watch(realPath, { recursive: true }, (event, filename) => {
      callback(event, filename || '');
    });
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Resolve virtual path
   */
  private resolvePath(virtualPath: string): string {
    // Normalize and ensure it starts with /
    let resolved = path.posix.normalize(virtualPath);
    if (!resolved.startsWith('/')) {
      resolved = '/' + resolved;
    }

    // Prevent path traversal
    if (resolved.includes('..')) {
      throw new SecurityError('Path traversal detected');
    }

    return resolved;
  }

  /**
   * Convert virtual path to real path
   */
  private toRealPath(virtualPath: string): string {
    return path.join(this.rootPath, virtualPath);
  }

  /**
   * Check read access
   */
  private checkReadAccess(virtualPath: string): void {
    // Check denied patterns
    if (this.matchesPatterns(virtualPath, this.config.deniedPatterns)) {
      throw new SecurityError(`Access denied: ${virtualPath}`);
    }

    // Check read-only patterns (can read but not write)
    // This is informational for read operations
  }

  /**
   * Check write access
   */
  private checkWriteAccess(virtualPath: string): void {
    // Check denied patterns
    if (this.matchesPatterns(virtualPath, this.config.deniedPatterns)) {
      throw new SecurityError(`Access denied: ${virtualPath}`);
    }

    // Check read-only patterns
    if (this.matchesPatterns(virtualPath, this.config.readOnlyPatterns)) {
      throw new SecurityError(`Read-only path: ${virtualPath}`);
    }
  }

  /**
   * Check if path matches any pattern
   */
  private matchesPatterns(path: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchPattern(path, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match path against pattern
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Simple glob matching
    const regex = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    
    return new RegExp(`^${regex}$`).test(path);
  }

  /**
   * Get file permissions string
   */
  private getFilePermissions(mode: number): string {
    const owner = (mode >> 6) & 7;
    const group = (mode >> 3) & 7;
    const other = mode & 7;

    let perms = '';
    
    // Owner
    perms += (owner & 4) ? 'r' : '-';
    perms += (owner & 2) ? 'w' : '-';
    perms += (owner & 1) ? 'x' : '-';

    // Group
    perms += (group & 4) ? 'r' : '-';
    perms += (group & 2) ? 'w' : '-';
    perms += (group & 1) ? 'x' : '-';

    // Other
    perms += (other & 4) ? 'r' : '-';
    perms += (other & 2) ? 'w' : '-';
    perms += (other & 1) ? 'x' : '-';

    return perms;
  }

  /**
   * Get total size
   */
  async getTotalSize(): Promise<number> {
    let total = 0;

    const calculateSize = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await calculateSize(fullPath);
          } else {
            const stats = await fs.promises.stat(fullPath);
            total += stats.size;
          }
        }
      } catch {
        // Ignore errors
      }
    };

    await calculateSize(this.rootPath);
    return total;
  }

  /**
   * Clear all files
   */
  async clear(): Promise<void> {
    this.files.clear();
    this.directories.clear();

    // Clear real files
    try {
      const entries = await fs.promises.readdir(this.rootPath);
      for (const entry of entries) {
        await fs.promises.rm(path.join(this.rootPath, entry), { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }

    // Recreate default structure
    await this.createDefaultStructure();
  }
}

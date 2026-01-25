/**
 * @fileoverview File System Tools Implementation
 * @description Advanced file system operations with streaming and boundary checking
 * @module @wrap-nebula/core/tools/files
 * @version 1.0.0
 * @author WRAP Nebula Team
 * @license MIT
 */

import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import type {
  Tool,
  ToolHandler,
  ToolExecutor,
  ToolExecutionContext,
  ToolResult,
  Boundaries,
  PathBoundary,
} from '../types';
import { ToolBuilder, checkPathBoundary } from './index';

// ============================================================================
// Types
// ============================================================================

/**
 * File information structure.
 */
interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  createdAt: Date;
  modifiedAt: Date;
  accessedAt: Date;
  permissions: string;
  mode: number;
}

/**
 * Directory listing options.
 */
interface ListDirectoryOptions {
  path: string;
  recursive?: boolean;
  includeHidden?: boolean;
  includeFiles?: boolean;
  includeDirectories?: boolean;
  pattern?: string;
  maxDepth?: number;
}

/**
 * Directory listing result.
 */
interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  extension?: string;
  depth: number;
}

/**
 * Copy options.
 */
interface CopyOptions {
  source: string;
  destination: string;
  overwrite?: boolean;
  preserveTimestamps?: boolean;
  filter?: (src: string) => boolean;
}

/**
 * Move options.
 */
interface MoveOptions {
  source: string;
  destination: string;
  overwrite?: boolean;
}

/**
 * Search options.
 */
interface SearchOptions {
  path: string;
  pattern: string;
  type?: 'file' | 'directory' | 'both';
  maxDepth?: number;
  caseSensitive?: boolean;
  includeHidden?: boolean;
}

/**
 * Watch event.
 */
interface WatchEvent {
  type: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  timestamp: number;
}

/**
 * Watch callback.
 */
type WatchCallback = (event: WatchEvent) => void;

// ============================================================================
// File System Utilities
// ============================================================================

/**
 * Normalize a file path.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * Join path segments.
 */
export function joinPaths(...segments: string[]): string {
  return normalizePath(segments.join('/'));
}

/**
 * Get the directory name from a path.
 */
export function getDirectoryName(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '.' : normalized.slice(0, lastSlash) || '/';
}

/**
 * Get the file name from a path.
 */
export function getFileName(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * Get the file extension from a path.
 */
export function getFileExtension(path: string): string {
  const fileName = getFileName(path);
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? '' : fileName.slice(lastDot + 1);
}

/**
 * Check if a path is absolute.
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

/**
 * Resolve a path to an absolute path.
 */
export async function resolvePath(
  path: string,
  workingDirectory: string
): Promise<string> {
  const { resolve } = await import('path');
  return resolve(workingDirectory, path);
}

/**
 * Get file stats.
 */
export async function getFileStats(
  path: string
): Promise<FileInfo | null> {
  const { promises: fs } = await import('fs');

  try {
    const stats = await fs.lstat(path);
    const name = getFileName(path);

    return {
      path,
      name,
      extension: getFileExtension(path),
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      isSymbolicLink: stats.isSymbolicLink(),
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      accessedAt: stats.atime,
      permissions: getPermissionString(stats.mode),
      mode: stats.mode,
    };
  } catch {
    return null;
  }
}

/**
 * Convert mode to permission string.
 */
function getPermissionString(mode: number): string {
  const permissions = ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x'];
  let result = '';

  for (let i = 0; i < 9; i++) {
    const bit = (mode >> (8 - i)) & 1;
    result += bit ? permissions[i] : '-';
  }

  return result;
}

// ============================================================================
// File Tools
// ============================================================================

/**
 * Create the file info tool.
 */
export function createFileInfoTool(): ToolHandler {
  return ToolBuilder.create('file_info', 'Get File Info')
    .description('Get detailed information about a file or directory')
    .string('path', { required: true, description: 'Path to the file or directory' })
    .category('filesystem')
    .tags('file', 'info', 'metadata')
    .timeout(5000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const path = await import('path');

      const filePath = params.path as string;

      try {
        // Check boundaries
        const boundaryCheck = checkPathBoundary(filePath, 'read', context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const resolvedPath = path.resolve(context.workingDirectory, filePath);
        const info = await getFileStats(resolvedPath);

        if (!info) {
          return {
            success: false,
            error: `File not found: ${filePath}`,
            errorCode: 'FILE_NOT_FOUND',
            executionTime: Date.now() - startTime,
          };
        }

        return {
          success: true,
          data: info,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'INFO_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the list directory tool.
 */
export function createListDirectoryTool(): ToolHandler {
  return ToolBuilder.create('list_directory', 'List Directory')
    .description('List contents of a directory')
    .string('path', { required: true, description: 'Directory path to list' })
    .boolean('recursive', { default: false, description: 'List recursively' })
    .boolean('includeHidden', { default: false, description: 'Include hidden files' })
    .boolean('includeFiles', { default: true, description: 'Include files' })
    .boolean('includeDirectories', { default: true, description: 'Include directories' })
    .string('pattern', { description: 'Glob pattern to filter results' })
    .integer('maxDepth', { default: 10, minimum: 1, maximum: 50, description: 'Maximum recursion depth' })
    .category('filesystem')
    .tags('directory', 'list', 'files')
    .timeout(15000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const dirPath = params.path as string;
      const recursive = (params.recursive as boolean) ?? false;
      const includeHidden = (params.includeHidden as boolean) ?? false;
      const includeFiles = (params.includeFiles as boolean) ?? true;
      const includeDirectories = (params.includeDirectories as boolean) ?? true;
      const pattern = params.pattern as string | undefined;
      const maxDepth = (params.maxDepth as number) ?? 10;

      try {
        // Check boundaries
        const boundaryCheck = checkPathBoundary(dirPath, 'read', context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const resolvedPath = path.resolve(context.workingDirectory, dirPath);
        const entries: DirectoryEntry[] = [];

        const listDir = async (dir: string, depth: number): Promise<void> => {
          if (depth > maxDepth) return;

          const items = await fs.readdir(dir, { withFileTypes: true });

          for (const item of items) {
            // Skip hidden files if not included
            if (!includeHidden && item.name.startsWith('.')) continue;

            const itemPath = path.join(dir, item.name);
            const relativePath = path.relative(resolvedPath, itemPath);
            const isDir = item.isDirectory();

            // Apply filters
            if (!includeFiles && item.isFile()) continue;
            if (!includeDirectories && isDir) continue;

            // Apply pattern filter
            if (pattern && !matchGlob(item.name, pattern)) continue;

            entries.push({
              name: item.name,
              path: relativePath,
              isDirectory: isDir,
              isFile: item.isFile(),
              depth,
            });

            // Recurse if requested
            if (recursive && isDir) {
              await listDir(itemPath, depth + 1);
            }
          }
        };

        await listDir(resolvedPath, 0);

        return {
          success: true,
          data: {
            path: dirPath,
            entries,
            count: entries.length,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'LIST_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the file copy tool.
 */
export function createFileCopyTool(): ToolHandler {
  return ToolBuilder.create('file_copy', 'Copy File')
    .description('Copy a file or directory')
    .string('source', { required: true, description: 'Source path' })
    .string('destination', { required: true, description: 'Destination path' })
    .boolean('overwrite', { default: false, description: 'Overwrite existing files' })
    .boolean('preserveTimestamps', { default: true, description: 'Preserve file timestamps' })
    .category('filesystem')
    .tags('file', 'copy', 'duplicate')
    .dangerous()
    .requiresConfirmation()
    .timeout(30000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const source = params.source as string;
      const destination = params.destination as string;
      const overwrite = (params.overwrite as boolean) ?? false;
      const preserveTimestamps = (params.preserveTimestamps as boolean) ?? true;

      try {
        // Check boundaries for source (read)
        const sourceCheck = checkPathBoundary(source, 'read', context.boundaries);
        if (!sourceCheck.allowed) {
          return {
            success: false,
            error: `Source: ${sourceCheck.reason}`,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        // Check boundaries for destination (write)
        const destCheck = checkPathBoundary(destination, 'write', context.boundaries);
        if (!destCheck.allowed) {
          return {
            success: false,
            error: `Destination: ${destCheck.reason}`,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const resolvedSource = path.resolve(context.workingDirectory, source);
        const resolvedDest = path.resolve(context.workingDirectory, destination);

        // Check if destination exists
        if (!overwrite) {
          try {
            await fs.access(resolvedDest);
            return {
              success: false,
              error: 'Destination already exists',
              errorCode: 'DESTINATION_EXISTS',
              executionTime: Date.now() - startTime,
            };
          } catch {
            // Destination doesn't exist, which is what we want
          }
        }

        // Copy the file
        await fs.copyFile(resolvedSource, resolvedDest);

        // Preserve timestamps if requested
        if (preserveTimestamps) {
          const stats = await fs.stat(resolvedSource);
          await fs.utimes(resolvedDest, stats.atime, stats.mtime);
        }

        return {
          success: true,
          data: {
            source,
            destination,
            bytesCopied: (await fs.stat(resolvedDest)).size,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'COPY_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the file move tool.
 */
export function createFileMoveTool(): ToolHandler {
  return ToolBuilder.create('file_move', 'Move File')
    .description('Move or rename a file or directory')
    .string('source', { required: true, description: 'Source path' })
    .string('destination', { required: true, description: 'Destination path' })
    .boolean('overwrite', { default: false, description: 'Overwrite existing files' })
    .category('filesystem')
    .tags('file', 'move', 'rename')
    .dangerous()
    .requiresConfirmation()
    .timeout(30000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const source = params.source as string;
      const destination = params.destination as string;
      const overwrite = (params.overwrite as boolean) ?? false;

      try {
        // Check boundaries for source (write - deleting)
        const sourceCheck = checkPathBoundary(source, 'write', context.boundaries);
        if (!sourceCheck.allowed) {
          return {
            success: false,
            error: `Source: ${sourceCheck.reason}`,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        // Check boundaries for destination (write)
        const destCheck = checkPathBoundary(destination, 'write', context.boundaries);
        if (!destCheck.allowed) {
          return {
            success: false,
            error: `Destination: ${destCheck.reason}`,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const resolvedSource = path.resolve(context.workingDirectory, source);
        const resolvedDest = path.resolve(context.workingDirectory, destination);

        // Check if destination exists
        if (!overwrite) {
          try {
            await fs.access(resolvedDest);
            return {
              success: false,
              error: 'Destination already exists',
              errorCode: 'DESTINATION_EXISTS',
              executionTime: Date.now() - startTime,
            };
          } catch {
            // Destination doesn't exist
          }
        }

        // Create destination directory if needed
        await fs.mkdir(path.dirname(resolvedDest), { recursive: true });

        // Move the file
        await fs.rename(resolvedSource, resolvedDest);

        return {
          success: true,
          data: {
            source,
            destination,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'MOVE_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the file delete tool.
 */
export function createFileDeleteTool(): ToolHandler {
  return ToolBuilder.create('file_delete', 'Delete File')
    .description('Delete a file or directory')
    .string('path', { required: true, description: 'Path to delete' })
    .boolean('recursive', { default: false, description: 'Delete directories recursively' })
    .boolean('force', { default: false, description: 'Force deletion even if not empty' })
    .category('filesystem')
    .tags('file', 'delete', 'remove')
    .dangerous()
    .requiresConfirmation()
    .timeout(30000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const filePath = params.path as string;
      const recursive = (params.recursive as boolean) ?? false;
      const force = (params.force as boolean) ?? false;

      try {
        // Check boundaries
        const boundaryCheck = checkPathBoundary(filePath, 'write', context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const resolvedPath = path.resolve(context.workingDirectory, filePath);

        // Check if exists
        const stats = await fs.lstat(resolvedPath);

        if (stats.isDirectory()) {
          if (recursive || force) {
            await fs.rm(resolvedPath, { recursive: true });
          } else {
            await fs.rmdir(resolvedPath);
          }
        } else {
          await fs.unlink(resolvedPath);
        }

        return {
          success: true,
          data: {
            path: filePath,
            deleted: true,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'DELETE_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the file search tool.
 */
export function createFileSearchTool(): ToolHandler {
  return ToolBuilder.create('file_search', 'Search Files')
    .description('Search for files matching a pattern')
    .string('path', { required: true, description: 'Directory to search in' })
    .string('pattern', { required: true, description: 'Search pattern (glob or regex)' })
    .string('type', { default: 'file', enum: ['file', 'directory', 'both'], description: 'What to search for' })
    .integer('maxDepth', { default: 20, minimum: 1, maximum: 100, description: 'Maximum search depth' })
    .boolean('caseSensitive', { default: false, description: 'Case sensitive matching' })
    .boolean('includeHidden', { default: false, description: 'Include hidden files' })
    .category('filesystem')
    .tags('file', 'search', 'find', 'glob')
    .timeout(30000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const searchPath = params.path as string;
      const pattern = params.pattern as string;
      const type = (params.type as string) ?? 'file';
      const maxDepth = (params.maxDepth as number) ?? 20;
      const caseSensitive = (params.caseSensitive as boolean) ?? false;
      const includeHidden = (params.includeHidden as boolean) ?? false;

      try {
        // Check boundaries
        const boundaryCheck = checkPathBoundary(searchPath, 'read', context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const resolvedPath = path.resolve(context.workingDirectory, searchPath);
        const results: string[] = [];

        const search = async (dir: string, depth: number): Promise<void> => {
          if (depth > maxDepth) return;

          const items = await fs.readdir(dir, { withFileTypes: true });

          for (const item of items) {
            // Skip hidden files if not included
            if (!includeHidden && item.name.startsWith('.')) continue;

            const itemPath = path.join(dir, item.name);
            const relativePath = path.relative(resolvedPath, itemPath);

            // Check if matches pattern
            const nameToMatch = caseSensitive ? item.name : item.name.toLowerCase();
            const patternToMatch = caseSensitive ? pattern : pattern.toLowerCase();

            if (matchGlob(nameToMatch, patternToMatch)) {
              const isFile = item.isFile();
              const isDir = item.isDirectory();

              if (
                (type === 'file' && isFile) ||
                (type === 'directory' && isDir) ||
                type === 'both'
              ) {
                results.push(relativePath);
              }
            }

            // Recurse into directories
            if (item.isDirectory()) {
              await search(itemPath, depth + 1);
            }
          }
        };

        await search(resolvedPath, 0);

        return {
          success: true,
          data: {
            path: searchPath,
            pattern,
            results,
            count: results.length,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'SEARCH_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the file hash tool.
 */
export function createFileHashTool(): ToolHandler {
  return ToolBuilder.create('file_hash', 'Calculate File Hash')
    .description('Calculate hash of a file')
    .string('path', { required: true, description: 'File path' })
    .string('algorithm', { default: 'sha256', enum: ['md5', 'sha1', 'sha256', 'sha512'], description: 'Hash algorithm' })
    .category('filesystem')
    .tags('file', 'hash', 'checksum')
    .timeout(30000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const filePath = params.path as string;
      const algorithm = (params.algorithm as string) ?? 'sha256';

      try {
        // Check boundaries
        const boundaryCheck = checkPathBoundary(filePath, 'read', context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const resolvedPath = path.resolve(context.workingDirectory, filePath);

        // Read file and calculate hash
        const content = await fs.readFile(resolvedPath);
        const hash = createHash(algorithm).update(content).digest('hex');

        return {
          success: true,
          data: {
            path: filePath,
            algorithm,
            hash,
            size: content.length,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'HASH_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Match a string against a glob pattern.
 */
function matchGlob(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/<<<DOUBLE_STAR>>>/g, '.*');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(str);
}

// ============================================================================
// Exports
// ============================================================================

export {
  createFileInfoTool,
  createListDirectoryTool,
  createFileCopyTool,
  createFileMoveTool,
  createFileDeleteTool,
  createFileSearchTool,
  createFileHashTool,
};

export type {
  FileInfo,
  ListDirectoryOptions,
  DirectoryEntry,
  CopyOptions,
  MoveOptions,
  SearchOptions,
  WatchEvent,
  WatchCallback,
};

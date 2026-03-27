/**
 * WRAP NEBULA v2.0 - Utility Functions
 * Common utility functions used throughout the codebase
 */

import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID
 */
export function generateId(prefix: string = ''): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Generate a short ID
 */
export function generateShortId(length: number = 8): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Generate a deterministic ID from input
 */
export function generateDeterministicId(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Truncate string to length
 */
export function truncate(str: string, length: number, suffix: string = '...'): string {
  if (str.length <= length) return str;
  return str.slice(0, length - suffix.length) + suffix;
}

/**
 * Capitalize first letter
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert to camelCase
 */
export function camelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (c) => c.toLowerCase());
}

/**
 * Convert to PascalCase
 */
export function pascalCase(str: string): string {
  const camel = camelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Convert to snake_case
 */
export function snakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

/**
 * Convert to kebab-case
 */
export function kebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format duration to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// ============================================================================
// Object Utilities
// ============================================================================

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merge objects
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, ...sources: Partial<T>[]): T {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) {
          Object.assign(target, { [key]: {} });
        }
        deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return deepMerge(target, ...sources);
}

/**
 * Check if value is object
 */
export function isObject(item: unknown): item is Record<string, unknown> {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * Pick keys from object
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit keys from object
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Remove duplicates from array
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * Flatten nested array
 */
export function flatten<T>(array: (T | T[])[]): T[] {
  return array.flat() as T[];
}

/**
 * Group array by key
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const groupKey = String(item[key]);
    return {
      ...groups,
      [groupKey]: [...(groups[groupKey] || []), item],
    };
  }, {} as Record<string, T[]>);
}

/**
 * Sort array by key
 */
export function sortBy<T>(array: T[], key: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Sleep for milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    maxDelay?: number;
    multiplier?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delay = 1000,
    maxDelay = 30000,
    multiplier = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: Error | undefined;
  let currentDelay = delay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      await sleep(currentDelay);
      currentDelay = Math.min(currentDelay * multiplier, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Execute with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  message: string = 'Operation timed out'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    fn()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Check if string is valid URL
 */
export function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if string is valid JSON
 */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if value is empty
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return false;
}

// ============================================================================
// System Utilities
// ============================================================================

/**
 * Get system info
 */
export function getSystemInfo(): {
  platform: string;
  arch: string;
  hostname: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
  uptime: number;
} {
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
  };
}

/**
 * Get home directory
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Get temp directory
 */
export function getTempDir(): string {
  return os.tmpdir();
}

/**
 * Resolve path with home directory
 */
export function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

// ============================================================================
// Hash Utilities
// ============================================================================

/**
 * Create SHA256 hash
 */
export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Create MD5 hash
 */
export function md5(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Create HMAC
 */
export function hmac(data: string, secret: string, algorithm: string = 'sha256'): string {
  return crypto.createHmac(algorithm, secret).update(data).digest('hex');
}

// ============================================================================
// Encoding Utilities
// ============================================================================

/**
 * Base64 encode
 */
export function base64Encode(data: string): string {
  return Buffer.from(data, 'utf-8').toString('base64');
}

/**
 * Base64 decode
 */
export function base64Decode(data: string): string {
  return Buffer.from(data, 'base64').toString('utf-8');
}

/**
 * URL encode
 */
export function urlEncode(data: string): string {
  return encodeURIComponent(data);
}

/**
 * URL decode
 */
export function urlDecode(data: string): string {
  return decodeURIComponent(data);
}

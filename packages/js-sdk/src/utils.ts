/**
 * @fileoverview Utility functions and classes for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/utils
 * @description This module contains utility functions, logger implementation,
 * retry logic, async helpers, validation utilities, and other common functionality
 * used throughout the WRAP Nebula SDK.
 */

import type { LogLevel, RetryConfig } from './types';
import { TimeoutError, CancellationError } from './errors';

// ============================================================================
// LOGGING
// ============================================================================

/**
 * Console log level colors
 */
const LOG_COLORS = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  reset: '\x1b[0m',
} as const;

/**
 * Log level priority mapping
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Prefix for all log messages */
  prefix?: string;
  /** Whether to include timestamps */
  timestamps?: boolean;
  /** Whether to use colors in console output */
  colors?: boolean;
  /** Custom log handler */
  handler?: LogHandler;
  /** Whether to include source location */
  includeSource?: boolean;
  /** Custom format function */
  format?: LogFormatter;
}

/**
 * Log handler function type
 */
export type LogHandler = (
  level: LogLevel,
  message: string,
  args: unknown[],
  context?: Record<string, unknown>
) => void;

/**
 * Log formatter function type
 */
export type LogFormatter = (
  level: LogLevel,
  message: string,
  args: unknown[],
  context?: Record<string, unknown>
) => string;

/**
 * Log entry structure
 */
export interface LogEntry {
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Additional arguments */
  args: unknown[];
  /** Timestamp */
  timestamp: Date;
  /** Context data */
  context?: Record<string, unknown>;
  /** Source location */
  source?: {
    file?: string;
    line?: number;
    function?: string;
  };
}

/**
 * Logger class for structured logging
 * @description Provides configurable logging with levels, formatting, and custom handlers.
 * 
 * @example
 * ```typescript
 * const logger = new Logger({ level: 'debug', prefix: '[WRAP]' });
 * logger.info('Starting application');
 * logger.debug('Processing request', { requestId: '123' });
 * ```
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;
  private timestamps: boolean;
  private colors: boolean;
  private handler?: LogHandler;
  private includeSource: boolean;
  private format?: LogFormatter;
  private context: Record<string, unknown> = {};

  /**
   * Creates a new Logger instance
   * @param config - Logger configuration
   */
  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? 'info';
    this.prefix = config.prefix ?? '';
    this.timestamps = config.timestamps ?? true;
    this.colors = config.colors ?? true;
    this.handler = config.handler;
    this.includeSource = config.includeSource ?? false;
    this.format = config.format;
  }

  /**
   * Sets the log level
   * @param level - New log level
   */
  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Gets the current log level
   * @returns Current log level
   */
  public getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Sets the prefix for log messages
   * @param prefix - New prefix
   */
  public setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  /**
   * Sets default context for all log messages
   * @param context - Context data
   */
  public setContext(context: Record<string, unknown>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clears the default context
   */
  public clearContext(): void {
    this.context = {};
  }

  /**
   * Creates a child logger with additional context
   * @param context - Additional context
   * @returns New logger instance
   */
  public child(context: Record<string, unknown> = {}): Logger {
    const childLogger = new Logger({
      level: this.level,
      prefix: this.prefix,
      timestamps: this.timestamps,
      colors: this.colors,
      handler: this.handler,
      includeSource: this.includeSource,
      format: this.format,
    });
    childLogger.setContext({ ...this.context, ...context });
    return childLogger;
  }

  /**
   * Logs a debug message
   * @param message - Log message
   * @param args - Additional arguments
   */
  public debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  /**
   * Logs an info message
   * @param message - Log message
   * @param args - Additional arguments
   */
  public info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  /**
   * Logs a warning message
   * @param message - Log message
   * @param args - Additional arguments
   */
  public warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  /**
   * Logs an error message
   * @param message - Log message
   * @param args - Additional arguments
   */
  public error(message: string, ...args: unknown[]): void {
    this.log('error', message, args);
  }

  /**
   * Logs a message with the specified level
   * @param level - Log level
   * @param message - Log message
   * @param args - Additional arguments
   */
  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (this.level === 'silent') return;
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) return;

    const entry: LogEntry = {
      level,
      message,
      args,
      timestamp: new Date(),
      context: { ...this.context },
    };

    if (this.includeSource) {
      entry.source = this.getSourceInfo();
    }

    if (this.handler) {
      this.handler(level, message, args, entry.context);
      return;
    }

    const formattedMessage = this.format
      ? this.format(level, message, args, entry.context)
      : this.defaultFormat(level, message, args);

    this.output(level, formattedMessage, args);
  }

  /**
   * Default format for log messages
   */
  private defaultFormat(level: LogLevel, message: string, args: unknown[]): string {
    const parts: string[] = [];

    if (this.timestamps) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    if (this.prefix) {
      parts.push(this.prefix);
    }

    parts.push(`[${level.toUpperCase()}]`);
    parts.push(message);

    if (args.length > 0 && typeof args[0] === 'object') {
      parts.push(JSON.stringify(args[0], null, 2));
    }

    return parts.join(' ');
  }

  /**
   * Outputs the log message
   */
  private output(level: LogLevel, message: string, args: unknown[]): void {
    const color = this.colors ? LOG_COLORS[level] : '';
    const reset = this.colors ? LOG_COLORS.reset : '';
    
    const coloredMessage = `${color}${message}${reset}`;

    switch (level) {
      case 'debug':
      case 'info':
        console.log(coloredMessage, ...args.slice(typeof args[0] === 'object' ? 1 : 0));
        break;
      case 'warn':
        console.warn(coloredMessage, ...args.slice(typeof args[0] === 'object' ? 1 : 0));
        break;
      case 'error':
        console.error(coloredMessage, ...args.slice(typeof args[0] === 'object' ? 1 : 0));
        break;
    }
  }

  /**
   * Gets source information from the call stack
   */
  private getSourceInfo(): { file?: string; line?: number; function?: string } {
    const stack = new Error().stack?.split('\n') ?? [];
    
    for (let i = stack.length - 1; i >= 0; i--) {
      const line = stack[i];
      if (line && !line.includes('Logger') && !line.includes('utils.ts')) {
        const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
        if (match) {
          return {
            function: match[1],
            file: match[2],
            line: parseInt(match[3], 10),
          };
        }
      }
    }
    
    return {};
  }

  /**
   * Creates a no-op logger
   * @returns Logger that doesn't output anything
   */
  public static silent(): Logger {
    return new Logger({ level: 'silent' });
  }
}

/**
 * Default logger instance
 */
export const defaultLogger = new Logger({ level: 'info' });

// ============================================================================
// RETRY LOGIC
// ============================================================================

/**
 * Retry options for retryable operations
 */
export interface RetryOptions extends RetryConfig {
  /** Whether to retry on all errors */
  retryAll?: boolean;
  /** Specific error types to retry */
  retryOnErrors?: Array<new (...args: unknown[]) => Error>;
  /** Callback before each retry */
  onRetry?: (attempt: number, error: Error, delay: number) => void;
  /** Whether to use jitter in delay calculation */
  jitter?: boolean;
  /** Maximum jitter percentage (0-1) */
  jitterMax?: number;
}

/**
 * Calculates the delay for a retry attempt with exponential backoff
 * @param attempt - Current attempt number (0-indexed)
 * @param options - Retry options
 * @returns Delay in milliseconds
 */
export function calculateDelay(attempt: number, options: RetryOptions): number {
  const { initialDelay, maxDelay, backoffMultiplier, jitter, jitterMax = 0.2 } = options;
  
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt);
  delay = Math.min(delay, maxDelay);
  
  if (jitter) {
    const jitterAmount = delay * jitterMax * Math.random();
    delay = delay + jitterAmount - (delay * jitterMax / 2);
  }
  
  return Math.floor(delay);
}

/**
 * Checks if an error should trigger a retry
 * @param error - Error to check
 * @param options - Retry options
 * @returns Whether to retry
 */
export function shouldRetry(error: unknown, options: RetryOptions): boolean {
  if (options.retryAll) return true;
  
  if (options.retryOnErrors && error instanceof Error) {
    return options.retryOnErrors.some(ErrorType => error instanceof ErrorType);
  }
  
  // Default retry logic for common retryable errors
  if (error instanceof Error) {
    const retryableMessages = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ENETUNREACH',
      'EAI_AGAIN',
      'overload',
      'rate limit',
      'too many requests',
      'service unavailable',
      'internal error',
    ];
    
    const message = error.message.toLowerCase();
    return retryableMessages.some(msg => message.includes(msg.toLowerCase()));
  }
  
  return false;
}

/**
 * Sleep for a specified duration
 * @param ms - Duration in milliseconds
 * @param signal - Optional abort signal
 * @returns Promise that resolves after the duration
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancellationError('Operation already cancelled'));
      return;
    }
    
    const timeout = setTimeout(resolve, ms);
    
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new CancellationError('Operation cancelled'));
    });
  });
}

/**
 * Wraps a function with retry logic
 * @template TArgs - Function argument types
 * @template TReturn - Function return type
 * @param fn - Function to wrap
 * @param options - Retry options
 * @returns Wrapped function with retry logic
 */
export function withRetry<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: RetryOptions
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    return retry(() => fn(...args), options);
  };
}

/**
 * Executes a function with retry logic
 * @template T - Return type
 * @param fn - Function to execute
 * @param options - Retry options
 * @returns Result of the function
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxAttempts - 1 || !shouldRetry(error, options)) {
        throw lastError;
      }
      
      const delay = calculateDelay(attempt, {
        initialDelay,
        maxDelay,
        backoffMultiplier,
        jitter: options.jitter ?? true,
      });
      
      if (onRetry) {
        onRetry(attempt + 1, lastError, delay);
      }
      
      await sleep(delay);
    }
  }
  
  throw lastError ?? new Error('Retry failed');
}

/**
 * Creates a retry policy for common scenarios
 */
export const RetryPolicies = {
  /** No retries */
  none: (): RetryOptions => ({
    maxAttempts: 1,
    initialDelay: 0,
    maxDelay: 0,
    backoffMultiplier: 1,
  }),
  
  /** Standard retry with exponential backoff */
  standard: (): RetryOptions => ({
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    jitter: true,
  }),
  
  /** Aggressive retry for critical operations */
  aggressive: (): RetryOptions => ({
    maxAttempts: 10,
    initialDelay: 500,
    maxDelay: 60000,
    backoffMultiplier: 2,
    jitter: true,
  }),
  
  /** Quick retry for fast operations */
  quick: (): RetryOptions => ({
    maxAttempts: 3,
    initialDelay: 100,
    maxDelay: 1000,
    backoffMultiplier: 2,
    jitter: true,
  }),
  
  /** Network retry for HTTP operations */
  network: (): RetryOptions => ({
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
  }),
} as const;

// ============================================================================
// ASYNC UTILITIES
// ============================================================================

/**
 * Debounce options
 */
export interface DebounceOptions {
  /** Whether to call on the leading edge */
  leading?: boolean;
  /** Whether to call on the trailing edge */
  trailing?: boolean;
  /** Maximum wait time */
  maxWait?: number;
}

/**
 * Creates a debounced function
 * @template TArgs - Function argument types
 * @template TReturn - Function return type
 * @param fn - Function to debounce
 * @param wait - Wait time in milliseconds
 * @param options - Debounce options
 * @returns Debounced function
 */
export function debounce<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  wait: number,
  options: DebounceOptions = {}
): (...args: TArgs) => Promise<TReturn> {
  const { leading = false, trailing = true, maxWait } = options;
  
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastCallTime = 0;
  let lastArgs: TArgs | null = null;
  let lastThis: unknown = null;
  let result: TReturn;
  let resolveQueue: Array<(value: TReturn) => void> = [];

  const invoke = (): void => {
    if (lastArgs) {
      result = fn.apply(lastThis as ThisParameterType<typeof fn>, lastArgs);
      resolveQueue.forEach(resolve => resolve(result));
      resolveQueue = [];
      lastArgs = null;
      lastThis = null;
    }
  };

  const shouldInvoke = (time: number): boolean => {
    if (maxWait !== undefined) {
      return time - lastCallTime >= maxWait;
    }
    return false;
  };

  const debounced = async (...args: TArgs): Promise<TReturn> => {
    return new Promise(resolve => {
      const time = Date.now();
      lastCallTime = time;
      lastArgs = args;
      lastThis = this;
      resolveQueue.push(resolve);

      if (leading && !timeoutId) {
        invoke();
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (trailing) {
          invoke();
        }
      }, wait);
    });
  };

  return debounced;
}

/**
 * Creates a throttled function
 * @template TArgs - Function argument types
 * @template TReturn - Function return type
 * @param fn - Function to throttle
 * @param limit - Time limit in milliseconds
 * @returns Throttled function
 */
export function throttle<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  limit: number
): (...args: TArgs) => TReturn | undefined {
  let inThrottle = false;
  let lastResult: TReturn;

  return (...args: TArgs): TReturn | undefined => {
    if (!inThrottle) {
      lastResult = fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
      return lastResult;
    }
    return undefined;
  };
}

/**
 * Executes an async function with a timeout
 * @template T - Return type
 * @param fn - Function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param message - Timeout error message
 * @returns Result of the function
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(message, { timeoutMs }));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Executes an async function with cancellation support
 * @template T - Return type
 * @param fn - Function to execute
 * @param signal - Abort signal
 * @returns Result of the function
 */
export async function withCancellation<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    return fn(new AbortController().signal);
  }

  if (signal.aborted) {
    throw new CancellationError('Operation already cancelled');
  }

  return new Promise<T>((resolve, reject) => {
    const abortHandler = (): void => {
      reject(new CancellationError('Operation cancelled'));
    };

    signal.addEventListener('abort', abortHandler);

    fn(signal)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        signal.removeEventListener('abort', abortHandler);
      });
  });
}

/**
 * Executes multiple promises in parallel with a concurrency limit
 * @template T - Return type
 * @param items - Items to process
 * @param fn - Function to apply to each item
 * @param concurrency - Maximum concurrent operations
 * @returns Array of results
 */
export async function parallel<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  
  return results;
}

/**
 * Executes promises sequentially
 * @template T - Item type
 * @template R - Return type
 * @param items - Items to process
 * @param fn - Function to apply to each item
 * @returns Array of results
 */
export async function sequential<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i++) {
    results.push(await fn(items[i], i));
  }
  
  return results;
}

/**
 * Creates a deferred promise
 * @template T - Resolve value type
 * @returns Deferred promise
 */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Race multiple promises and return the first to resolve
 * @template T - Return type
 * @param promises - Promises to race
 * @returns First resolved promise
 */
export async function raceSettled<T>(promises: Promise<T>[]): Promise<T> {
  const { promise, resolve, reject } = deferred<T>();

  let settled = false;

  promises.forEach(promise => {
    promise
      .then(value => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      })
      .catch(error => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
  });

  return promise;
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors */
  errors: ValidationErrorInfo[];
}

/**
 * Validation error information
 */
export interface ValidationErrorInfo {
  /** Field that failed validation */
  field: string;
  /** Error message */
  message: string;
  /** Expected value or type */
  expected?: string;
  /** Actual value */
  actual?: unknown;
  /** Validation rule that failed */
  rule?: string;
}

/**
 * Validates that a value is defined
 * @param value - Value to check
 * @param field - Field name for error message
 * @returns Validation result
 */
export function validateDefined(value: unknown, field: string): ValidationResult {
  const errors: ValidationErrorInfo[] = [];
  
  if (value === undefined || value === null) {
    errors.push({
      field,
      message: `${field} is required`,
      expected: 'defined value',
      actual: value,
      rule: 'required',
    });
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates that a value is a string
 * @param value - Value to check
 * @param field - Field name for error message
 * @param options - Validation options
 * @returns Validation result
 */
export function validateString(
  value: unknown,
  field: string,
  options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    required?: boolean;
  } = {}
): ValidationResult {
  const errors: ValidationErrorInfo[] = [];
  
  if (value === undefined || value === null) {
    if (options.required) {
      errors.push({
        field,
        message: `${field} is required`,
        expected: 'string',
        actual: value,
        rule: 'required',
      });
    }
    return { valid: errors.length === 0, errors };
  }
  
  if (typeof value !== 'string') {
    errors.push({
      field,
      message: `${field} must be a string`,
      expected: 'string',
      actual: typeof value,
      rule: 'type',
    });
    return { valid: false, errors };
  }
  
  if (options.minLength !== undefined && value.length < options.minLength) {
    errors.push({
      field,
      message: `${field} must be at least ${options.minLength} characters`,
      expected: `min ${options.minLength} characters`,
      actual: `${value.length} characters`,
      rule: 'minLength',
    });
  }
  
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    errors.push({
      field,
      message: `${field} must be at most ${options.maxLength} characters`,
      expected: `max ${options.maxLength} characters`,
      actual: `${value.length} characters`,
      rule: 'maxLength',
    });
  }
  
  if (options.pattern && !options.pattern.test(value)) {
    errors.push({
      field,
      message: `${field} must match pattern ${options.pattern}`,
      expected: options.pattern.toString(),
      actual: value,
      rule: 'pattern',
    });
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates that a value is a number
 * @param value - Value to check
 * @param field - Field name for error message
 * @param options - Validation options
 * @returns Validation result
 */
export function validateNumber(
  value: unknown,
  field: string,
  options: {
    min?: number;
    max?: number;
    integer?: boolean;
    positive?: boolean;
    required?: boolean;
  } = {}
): ValidationResult {
  const errors: ValidationErrorInfo[] = [];
  
  if (value === undefined || value === null) {
    if (options.required) {
      errors.push({
        field,
        message: `${field} is required`,
        expected: 'number',
        actual: value,
        rule: 'required',
      });
    }
    return { valid: errors.length === 0, errors };
  }
  
  if (typeof value !== 'number' || isNaN(value)) {
    errors.push({
      field,
      message: `${field} must be a number`,
      expected: 'number',
      actual: typeof value,
      rule: 'type',
    });
    return { valid: false, errors };
  }
  
  if (options.integer && !Number.isInteger(value)) {
    errors.push({
      field,
      message: `${field} must be an integer`,
      expected: 'integer',
      actual: value,
      rule: 'integer',
    });
  }
  
  if (options.positive && value <= 0) {
    errors.push({
      field,
      message: `${field} must be positive`,
      expected: 'positive number',
      actual: value,
      rule: 'positive',
    });
  }
  
  if (options.min !== undefined && value < options.min) {
    errors.push({
      field,
      message: `${field} must be at least ${options.min}`,
      expected: `>= ${options.min}`,
      actual: value,
      rule: 'min',
    });
  }
  
  if (options.max !== undefined && value > options.max) {
    errors.push({
      field,
      message: `${field} must be at most ${options.max}`,
      expected: `<= ${options.max}`,
      actual: value,
      rule: 'max',
    });
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates that a value is an array
 * @param value - Value to check
 * @param field - Field name for error message
 * @param options - Validation options
 * @returns Validation result
 */
export function validateArray<T>(
  value: unknown,
  field: string,
  options: {
    minLength?: number;
    maxLength?: number;
    itemValidator?: (item: unknown, index: number) => ValidationResult;
    required?: boolean;
  } = {}
): ValidationResult {
  const errors: ValidationErrorInfo[] = [];
  
  if (value === undefined || value === null) {
    if (options.required) {
      errors.push({
        field,
        message: `${field} is required`,
        expected: 'array',
        actual: value,
        rule: 'required',
      });
    }
    return { valid: errors.length === 0, errors };
  }
  
  if (!Array.isArray(value)) {
    errors.push({
      field,
      message: `${field} must be an array`,
      expected: 'array',
      actual: typeof value,
      rule: 'type',
    });
    return { valid: false, errors };
  }
  
  if (options.minLength !== undefined && value.length < options.minLength) {
    errors.push({
      field,
      message: `${field} must have at least ${options.minLength} items`,
      expected: `min ${options.minLength} items`,
      actual: `${value.length} items`,
      rule: 'minLength',
    });
  }
  
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    errors.push({
      field,
      message: `${field} must have at most ${options.maxLength} items`,
      expected: `max ${options.maxLength} items`,
      actual: `${value.length} items`,
      rule: 'maxLength',
    });
  }
  
  if (options.itemValidator) {
    value.forEach((item, index) => {
      const result = options.itemValidator!(item, index);
      if (!result.valid) {
        result.errors.forEach(error => {
          errors.push({
            ...error,
            field: `${field}[${index}].${error.field}`,
          });
        });
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates that a value is an object
 * @param value - Value to check
 * @param field - Field name for error message
 * @param options - Validation options
 * @returns Validation result
 */
export function validateObject(
  value: unknown,
  field: string,
  options: {
    required?: boolean;
    allowEmpty?: boolean;
    properties?: Record<string, (value: unknown) => ValidationResult>;
  } = {}
): ValidationResult {
  const errors: ValidationErrorInfo[] = [];
  
  if (value === undefined || value === null) {
    if (options.required) {
      errors.push({
        field,
        message: `${field} is required`,
        expected: 'object',
        actual: value,
        rule: 'required',
      });
    }
    return { valid: errors.length === 0, errors };
  }
  
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push({
      field,
      message: `${field} must be an object`,
      expected: 'object',
      actual: Array.isArray(value) ? 'array' : typeof value,
      rule: 'type',
    });
    return { valid: false, errors };
  }
  
  const obj = value as Record<string, unknown>;
  
  if (!options.allowEmpty && Object.keys(obj).length === 0) {
    errors.push({
      field,
      message: `${field} cannot be empty`,
      expected: 'non-empty object',
      actual: 'empty object',
      rule: 'notEmpty',
    });
  }
  
  if (options.properties) {
    for (const [prop, validator] of Object.entries(options.properties)) {
      const propValue = obj[prop];
      const result = validator(propValue);
      if (!result.valid) {
        result.errors.forEach(error => {
          errors.push({
            ...error,
            field: `${field}.${error.field || prop}`,
          });
        });
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Combines multiple validation results
 * @param results - Validation results to combine
 * @returns Combined validation result
 */
export function combineValidations(...results: ValidationResult[]): ValidationResult {
  const errors: ValidationErrorInfo[] = [];
  
  for (const result of results) {
    errors.push(...result.errors);
  }
  
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generates a unique identifier
 * @param prefix - Optional prefix for the ID
 * @returns Unique identifier
 */
export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Generates a UUID v4
 * @returns UUID string
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generates a short ID
 * @param length - Length of the ID
 * @returns Short ID string
 */
export function generateShortId(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============================================================================
// MISC UTILITIES
// ============================================================================

/**
 * Deep clones a value
 * @template T - Value type
 * @param value - Value to clone
 * @returns Cloned value
 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  
  if (Array.isArray(value)) {
    return value.map(item => deepClone(item)) as T;
  }
  
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  
  if (value instanceof Map) {
    const cloned = new Map();
    value.forEach((v, k) => cloned.set(deepClone(k), deepClone(v)));
    return cloned as T;
  }
  
  if (value instanceof Set) {
    const cloned = new Set();
    value.forEach(v => cloned.add(deepClone(v)));
    return cloned as T;
  }
  
  const cloned = {} as T;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      cloned[key] = deepClone(value[key]);
    }
  }
  
  return cloned;
}

/**
 * Deep merges objects
 * @template T - Target type
 * @param target - Target object
 * @param sources - Source objects
 * @returns Merged object
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  if (!sources.length) return target;
  
  const source = sources.shift();
  
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) {
          Object.assign(target, { [key]: {} });
        }
        deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        );
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  
  return deepMerge(target, ...sources);
}

/**
 * Checks if a value is a plain object
 * @param value - Value to check
 * @returns Whether the value is a plain object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Picks specified keys from an object
 * @template T - Object type
 * @template K - Key type
 * @param obj - Source object
 * @param keys - Keys to pick
 * @returns New object with picked keys
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omits specified keys from an object
 * @template T - Object type
 * @template K - Key type
 * @param obj - Source object
 * @param keys - Keys to omit
 * @returns New object without omitted keys
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Checks if two values are deeply equal
 * @param a - First value
 * @param b - Second value
 * @returns Whether values are equal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    
    if (aKeys.length !== bKeys.length) return false;
    
    return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
  }
  
  return false;
}

/**
 * Formats bytes to a human-readable string
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places
 * @returns Formatted string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Formats milliseconds to a human-readable duration
 * @param ms - Milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Truncates a string to a maximum length
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to append when truncated
 * @returns Truncated string
 */
export function truncate(str: string, maxLength: number, suffix = '...'): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Escapes HTML special characters
 * @param str - String to escape
 * @returns Escaped string
 */
export function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  
  return str.replace(/[&<>"']/g, char => htmlEscapes[char] ?? char);
}

/**
 * Creates a hash of a string
 * @param str - String to hash
 * @returns Hash string
 */
export async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  Logger,
  defaultLogger,
  retry,
  withRetry,
  RetryPolicies,
  calculateDelay,
  shouldRetry,
  sleep,
  debounce,
  throttle,
  withTimeout,
  withCancellation,
  parallel,
  sequential,
  deferred,
  raceSettled,
  validateDefined,
  validateString,
  validateNumber,
  validateArray,
  validateObject,
  combineValidations,
  generateId,
  generateUUID,
  generateShortId,
  deepClone,
  deepMerge,
  isObject,
  pick,
  omit,
  deepEqual,
  formatBytes,
  formatDuration,
  truncate,
  escapeHtml,
  hashString,
};

/**
 * @fileoverview V8 Isolate implementation for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/sandbox/v8
 * @description This module provides V8 isolate-based sandboxing with memory limits,
 * timeout handling, and secure execution context management.
 */

import type {
  ExecutionContext,
  ExecutionResult,
  ResourceUsage,
  Boundaries,
} from '../types';
import { Logger, generateId, withTimeout } from '../utils';
import {
  V8IsolateError,
  SandboxMemoryError,
  SandboxExecutionError,
  TimeoutError,
  ErrorCodes,
} from '../errors';

// ============================================================================
// TYPES
// ============================================================================

/**
 * V8 Isolate configuration
 */
export interface V8IsolateConfig {
  /** Memory limit in bytes */
  memoryLimit: number;
  /** CPU time limit in milliseconds */
  cpuTimeLimit: number;
  /** Wall time limit in milliseconds */
  wallTimeLimit: number;
  /** Whether to capture stack traces */
  captureStackTraces?: boolean;
  /** Maximum stack depth */
  maxStackDepth?: number;
  /** Whether to enable async hooks */
  enableAsyncHooks?: boolean;
  /** Custom global objects */
  customGlobals?: Record<string, unknown>;
  /** Whether to allow eval */
  allowEval?: boolean;
  /** Whether to allow new Function */
  allowNewFunction?: boolean;
  /** Startup snapshot blob */
  startupSnapshot?: Buffer;
}

/**
 * V8 Isolate statistics
 */
export interface V8IsolateStats {
  /** Used heap size in bytes */
  usedHeapSize: number;
  /** Total heap size in bytes */
  totalHeapSize: number;
  /** Heap size limit in bytes */
  heapSizeLimit: number;
  /** Malloced memory in bytes */
  mallocedMemory: number;
  /** Number of native contexts */
  numberOfNativeContexts: number;
  /** Number of detached contexts */
  numberOfDetachedContexts: number;
}

/**
 * V8 Heap snapshot options
 */
export interface HeapSnapshotOptions {
  /** Whether to expose internals */
  exposeInternals?: boolean;
  /** Whether to expose numeric ids */
  exposeNumericIds?: boolean;
  /** Max snapshot size in bytes */
  maxSize?: number;
}

/**
 * V8 Heap space info
 */
export interface HeapSpaceInfo {
  /** Space name */
  spaceName: string;
  /** Space size in bytes */
  spaceSize: number;
  /** Space used size in bytes */
  spaceUsedSize: number;
  /** Space available size in bytes */
  spaceAvailableSize: number;
  /** Physical space size in bytes */
  physicalSpaceSize: number;
}

// ============================================================================
// V8 ISOLATE CLASS
// ============================================================================

/**
 * V8 Isolate implementation for secure code execution
 * @description Provides V8 isolate-based sandboxing with memory limits,
 * timeout handling, and secure execution context management.
 * 
 * @example
 * ```typescript
 * const isolate = new V8Isolate({
 *   memoryLimit: 128 * 1024 * 1024, // 128MB
 *   cpuTimeLimit: 5000, // 5 seconds
 *   wallTimeLimit: 10000, // 10 seconds
 * });
 * 
 * await isolate.initialize();
 * const result = await isolate.execute('return 1 + 1');
 * console.log(result.result); // 2
 * await isolate.dispose();
 * ```
 */
export class V8Isolate {
  /** Configuration */
  private config: V8IsolateConfig;
  /** Logger instance */
  private logger: Logger;
  /** Whether the isolate is initialized */
  private initialized = false;
  /** Whether the isolate is disposed */
  private disposed = false;
  /** Execution count */
  private executionCount = 0;
  /** Total execution time */
  private totalExecutionTime = 0;
  /** Peak memory usage */
  private peakMemoryUsage = 0;
  /** Active executions */
  private activeExecutions: Set<string> = new Set();
  /** Global context */
  private globalContext: Record<string, unknown> = {};
  /** Last statistics */
  private lastStats: V8IsolateStats | null = null;

  /**
   * Creates a new V8 Isolate instance
   * @param config - Isolate configuration
   */
  constructor(config: V8IsolateConfig) {
    this.config = {
      captureStackTraces: true,
      maxStackDepth: 100,
      enableAsyncHooks: false,
      customGlobals: {},
      allowEval: false,
      allowNewFunction: false,
      ...config,
    };
    
    this.logger = new Logger({
      level: 'info',
      prefix: '[V8Isolate]',
    });
    
    this.logger.debug('V8Isolate instance created');
  }

  /**
   * Gets the memory limit
   */
  public get memoryLimit(): number {
    return this.config.memoryLimit;
  }

  /**
   * Gets the CPU time limit
   */
  public get cpuTimeLimit(): number {
    return this.config.cpuTimeLimit;
  }

  /**
   * Gets the wall time limit
   */
  public get wallTimeLimit(): number {
    return this.config.wallTimeLimit;
  }

  /**
   * Gets whether the isolate is initialized
   */
  public get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Gets whether the isolate is disposed
   */
  public get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Initializes the isolate
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Isolate already initialized');
      return;
    }
    
    if (this.disposed) {
      throw new V8IsolateError('Isolate has been disposed');
    }
    
    this.logger.info('Initializing V8 isolate');
    
    try {
      // Initialize global context
      this.globalContext = this.createGlobalContext();
      
      this.initialized = true;
      this.logger.info('V8 isolate initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize V8 isolate', error);
      throw new V8IsolateError('Failed to initialize V8 isolate', {
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Creates the global context for execution
   * @returns Global context object
   */
  private createGlobalContext(): Record<string, unknown> {
    const context: Record<string, unknown> = {
      // Safe console implementation
      console: this.createSafeConsole(),
      // Timer functions (will be overridden by safe versions)
      setTimeout: undefined,
      setInterval: undefined,
      clearTimeout: undefined,
      clearInterval: undefined,
      setImmediate: undefined,
      clearImmediate: undefined,
      // Queue functions
      queueMicrotask: undefined,
      // Custom globals
      ...this.config.customGlobals,
    };
    
    // Remove dangerous functions if not allowed
    if (!this.config.allowEval) {
      context.eval = undefined;
    }
    
    return context;
  }

  /**
   * Creates a safe console implementation
   * @returns Safe console object
   */
  private createSafeConsole(): Record<string, (...args: unknown[]) => void> {
    const logger = this.logger;
    
    return {
      log: (...args: unknown[]): void => {
        logger.info('[Sandbox]', ...args);
      },
      info: (...args: unknown[]): void => {
        logger.info('[Sandbox]', ...args);
      },
      warn: (...args: unknown[]): void => {
        logger.warn('[Sandbox]', ...args);
      },
      error: (...args: unknown[]): void => {
        logger.error('[Sandbox]', ...args);
      },
      debug: (...args: unknown[]): void => {
        logger.debug('[Sandbox]', ...args);
      },
      trace: (...args: unknown[]): void => {
        logger.debug('[Sandbox TRACE]', ...args);
      },
      table: (...args: unknown[]): void => {
        logger.info('[Sandbox TABLE]', ...args);
      },
      dir: (...args: unknown[]): void => {
        logger.info('[Sandbox DIR]', ...args);
      },
      time: (): void => {
        // No-op for safety
      },
      timeEnd: (): void => {
        // No-op for safety
      },
      group: (): void => {
        // No-op for safety
      },
      groupEnd: (): void => {
        // No-op for safety
      },
      clear: (): void => {
        // No-op for safety
      },
      count: (): void => {
        // No-op for safety
      },
      countReset: (): void => {
        // No-op for safety
      },
      assert: (condition: boolean, ...args: unknown[]): void => {
        if (!condition) {
          logger.warn('[Sandbox ASSERT FAILED]', ...args);
        }
      },
    };
  }

  /**
   * Executes code in the isolate
   * @param code - Code to execute
   * @param context - Execution context
   * @returns Execution result
   */
  public async execute(
    code: string,
    context?: ExecutionContext
  ): Promise<ExecutionResult> {
    this.ensureInitialized();
    
    const executionId = context?.executionId ?? generateId('exec');
    const startTime = Date.now();
    
    this.activeExecutions.add(executionId);
    this.executionCount++;
    
    this.logger.debug(`Starting execution: ${executionId}`);
    
    try {
      // Execute with timeout
      const result = await withTimeout(
        async () => this.executeInternal(code, executionId, startTime),
        this.config.wallTimeLimit,
        `Execution timeout (${this.config.wallTimeLimit}ms)`
      );
      
      // Update statistics
      const endTime = Date.now();
      const duration = endTime - startTime;
      this.totalExecutionTime += duration;
      
      return result;
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Handle timeout
      if (error instanceof TimeoutError) {
        return {
          executionId,
          state: 'timeout',
          error: {
            type: 'timeout',
            message: error.message,
            retryable: true,
          },
          startedAt: new Date(startTime),
          endedAt: new Date(endTime),
          duration,
        };
      }
      
      // Handle memory error
      if (this.isMemoryError(error)) {
        return {
          executionId,
          state: 'failed',
          error: {
            type: 'memory',
            message: 'Memory limit exceeded',
            retryable: false,
          },
          startedAt: new Date(startTime),
          endedAt: new Date(endTime),
          duration,
        };
      }
      
      // Handle other errors
      return {
        executionId,
        state: 'failed',
        error: {
          type: 'runtime',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          retryable: false,
        },
        startedAt: new Date(startTime),
        endedAt: new Date(endTime),
        duration,
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Internal execution implementation
   * @param code - Code to execute
   * @param executionId - Execution ID
   * @param startTime - Start timestamp
   * @returns Execution result
   */
  private async executeInternal(
    code: string,
    executionId: string,
    startTime: number
  ): Promise<ExecutionResult> {
    try {
      // Check if eval is allowed
      if (!this.config.allowEval && code.includes('eval(')) {
        throw new V8IsolateError('eval is not allowed in this sandbox');
      }
      
      // Check if new Function is allowed
      if (!this.config.allowNewFunction && code.includes('new Function')) {
        throw new V8IsolateError('new Function is not allowed in this sandbox');
      }
      
      // Wrap code for execution
      const wrappedCode = this.wrapCode(code);
      
      // Execute using Function constructor (simulated V8 behavior)
      // In production, this would use actual V8 isolates
      let result: unknown;
      
      // Simulate V8 isolate execution
      const memoryBefore = this.getMemoryUsage();
      
      try {
        // Create execution function with restricted context
        const executeFn = new Function(
          '__globals__',
          `"use strict";\n${wrappedCode}`
        );
        
        result = executeFn(this.globalContext);
        
        // Handle promises
        if (result instanceof Promise) {
          result = await Promise.race([
            result,
            this.createTimeoutPromise(this.config.wallTimeLimit),
          ]);
        }
      } catch (error) {
        // Handle execution error
        throw new SandboxExecutionError(
          error instanceof Error ? error.message : String(error),
          {
            code,
          }
        );
      }
      
      const memoryAfter = this.getMemoryUsage();
      const memoryUsed = memoryAfter - memoryBefore;
      
      // Update peak memory
      if (memoryUsed > this.peakMemoryUsage) {
        this.peakMemoryUsage = memoryUsed;
      }
      
      // Check memory limit
      if (memoryUsed > this.config.memoryLimit) {
        throw new SandboxMemoryError('Memory limit exceeded', {
          memoryLimit: this.config.memoryLimit,
          memoryUsed,
        });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      return {
        executionId,
        state: 'completed',
        result,
        startedAt: new Date(startTime),
        endedAt: new Date(endTime),
        duration,
        resourceUsage: {
          cpuTimeMs: duration,
          wallTimeMs: duration,
          memoryBytes: memoryUsed,
          peakMemoryBytes: memoryUsed,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      
      return {
        executionId,
        state: 'failed',
        error: {
          type: this.getErrorType(error),
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          retryable: false,
        },
        startedAt: new Date(startTime),
        endedAt: new Date(endTime),
        duration: endTime - startTime,
      };
    }
  }

  /**
   * Wraps code for safe execution
   * @param code - Code to wrap
   * @returns Wrapped code
   */
  private wrapCode(code: string): string {
    // Extract globals from context
    const globalKeys = Object.keys(this.globalContext);
    const globalDeclarations = globalKeys
      .map(key => `const ${key} = __globals__['${key}'];`)
      .join('\n');
    
    return `
${globalDeclarations}

// User code
${code}
    `.trim();
  }

  /**
   * Creates a timeout promise
   * @param ms - Timeout in milliseconds
   * @returns Promise that rejects after timeout
   */
  private createTimeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError('Execution timeout', { timeoutMs: ms }));
      }, ms);
    });
  }

  /**
   * Gets memory usage
   * @returns Memory usage in bytes
   */
  private getMemoryUsage(): number {
    // In production, this would use V8.GetHeapStatistics()
    // For now, use process.memoryUsage() if available
    try {
      // @ts-expect-error - process might not be available
      if (typeof process !== 'undefined' && process.memoryUsage) {
        // @ts-expect-error - process might not be available
        return process.memoryUsage().heapUsed;
      }
    } catch {
      // Ignore
    }
    
    // Estimate based on execution count
    return this.executionCount * 1024;
  }

  /**
   * Checks if an error is a memory error
   * @param error - Error to check
   * @returns Whether it's a memory error
   */
  private isMemoryError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('out of memory') ||
        message.includes('heap limit') ||
        message.includes('memory allocation failed')
      );
    }
    return false;
  }

  /**
   * Gets the error type from an error
   * @param error - Error to check
   * @returns Error type
   */
  private getErrorType(error: unknown): 'runtime' | 'timeout' | 'memory' | 'permission' | 'validation' | 'unknown' {
    if (error instanceof TimeoutError) return 'timeout';
    if (this.isMemoryError(error)) return 'memory';
    if (error instanceof V8IsolateError) return 'permission';
    if (error instanceof SyntaxError) return 'validation';
    if (error instanceof Error) return 'runtime';
    return 'unknown';
  }

  /**
   * Gets isolate statistics
   * @returns Isolate statistics
   */
  public getStats(): V8IsolateStats {
    // In production, this would use v8.getHeapStatistics()
    const memoryUsage = this.getMemoryUsage();
    
    this.lastStats = {
      usedHeapSize: memoryUsage,
      totalHeapSize: this.config.memoryLimit,
      heapSizeLimit: this.config.memoryLimit,
      mallocedMemory: 0,
      numberOfNativeContexts: 1,
      numberOfDetachedContexts: 0,
    };
    
    return { ...this.lastStats };
  }

  /**
   * Gets heap space statistics
   * @returns Array of heap space info
   */
  public getHeapSpaceStats(): HeapSpaceInfo[] {
    // Simulated heap space info
    const memoryUsage = this.getMemoryUsage();
    
    return [
      {
        spaceName: 'new_space',
        spaceSize: 2 * 1024 * 1024,
        spaceUsedSize: memoryUsage * 0.1,
        spaceAvailableSize: 2 * 1024 * 1024 - memoryUsage * 0.1,
        physicalSpaceSize: 2 * 1024 * 1024,
      },
      {
        spaceName: 'old_space',
        spaceSize: this.config.memoryLimit * 0.6,
        spaceUsedSize: memoryUsage * 0.6,
        spaceAvailableSize: this.config.memoryLimit * 0.6 - memoryUsage * 0.6,
        physicalSpaceSize: this.config.memoryLimit * 0.6,
      },
      {
        spaceName: 'code_space',
        spaceSize: this.config.memoryLimit * 0.1,
        spaceUsedSize: memoryUsage * 0.05,
        spaceAvailableSize: this.config.memoryLimit * 0.1 - memoryUsage * 0.05,
        physicalSpaceSize: this.config.memoryLimit * 0.1,
      },
      {
        spaceName: 'map_space',
        spaceSize: this.config.memoryLimit * 0.05,
        spaceUsedSize: memoryUsage * 0.05,
        spaceAvailableSize: this.config.memoryLimit * 0.05 - memoryUsage * 0.05,
        physicalSpaceSize: this.config.memoryLimit * 0.05,
      },
      {
        spaceName: 'large_object_space',
        spaceSize: this.config.memoryLimit * 0.25,
        spaceUsedSize: memoryUsage * 0.2,
        spaceAvailableSize: this.config.memoryLimit * 0.25 - memoryUsage * 0.2,
        physicalSpaceSize: this.config.memoryLimit * 0.25,
      },
    ];
  }

  /**
   * Triggers garbage collection
   */
  public async gc(): Promise<void> {
    // In production, this would use v8.writeHeapSnapshot() or similar
    this.logger.debug('Garbage collection triggered');
    
    // Simulate GC delay
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  /**
   * Sets a global variable
   * @param name - Variable name
   * @param value - Variable value
   */
  public setGlobal(name: string, value: unknown): void {
    this.ensureInitialized();
    this.globalContext[name] = value;
  }

  /**
   * Gets a global variable
   * @param name - Variable name
   * @returns Variable value
   */
  public getGlobal<T = unknown>(name: string): T | undefined {
    this.ensureInitialized();
    return this.globalContext[name] as T | undefined;
  }

  /**
   * Deletes a global variable
   * @param name - Variable name
   */
  public deleteGlobal(name: string): void {
    this.ensureInitialized();
    delete this.globalContext[name];
  }

  /**
   * Gets resource usage
   * @returns Resource usage
   */
  public getResourceUsage(): ResourceUsage {
    const stats = this.getStats();
    
    return {
      cpuTimeMs: this.totalExecutionTime,
      wallTimeMs: this.totalExecutionTime,
      memoryBytes: stats.usedHeapSize,
      peakMemoryBytes: this.peakMemoryUsage,
    };
  }

  /**
   * Gets execution count
   * @returns Number of executions
   */
  public getExecutionCount(): number {
    return this.executionCount;
  }

  /**
   * Gets active execution count
   * @returns Number of active executions
   */
  public getActiveExecutionCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Ensures the isolate is initialized
   */
  private ensureInitialized(): void {
    if (this.disposed) {
      throw new V8IsolateError('Isolate has been disposed');
    }
    
    if (!this.initialized) {
      throw new V8IsolateError('Isolate not initialized. Call initialize() first.');
    }
  }

  /**
   * Disposes the isolate
   */
  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    
    this.logger.info('Disposing V8 isolate');
    
    // Wait for active executions to complete
    const maxWait = 5000;
    const startTime = Date.now();
    
    while (this.activeExecutions.size > 0 && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Clear global context
    this.globalContext = {};
    
    // Clear statistics
    this.lastStats = null;
    
    // Mark as disposed
    this.disposed = true;
    this.initialized = false;
    
    this.logger.info('V8 isolate disposed');
  }

  /**
   * Creates a snapshot of the isolate state
   * @returns Snapshot buffer
   */
  public async createSnapshot(): Promise<Buffer> {
    this.ensureInitialized();
    
    // In production, this would use v8.writeHeapSnapshot()
    const state = {
      globals: this.globalContext,
      executionCount: this.executionCount,
      totalExecutionTime: this.totalExecutionTime,
      peakMemoryUsage: this.peakMemoryUsage,
    };
    
    return Buffer.from(JSON.stringify(state));
  }

  /**
   * Restores isolate state from a snapshot
   * @param snapshot - Snapshot buffer
   */
  public async restoreSnapshot(snapshot: Buffer): Promise<void> {
    this.ensureInitialized();
    
    try {
      const state = JSON.parse(snapshot.toString());
      
      if (state.globals) {
        this.globalContext = { ...this.globalContext, ...state.globals };
      }
      
      this.logger.info('Snapshot restored');
    } catch (error) {
      throw new V8IsolateError('Failed to restore snapshot', {
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}

// ============================================================================
// V8 ISOLATE POOL
// ============================================================================

/**
 * Pool of V8 isolates for concurrent execution
 */
export class V8IsolatePool {
  /** Pool configuration */
  private config: V8IsolateConfig;
  /** Available isolates */
  private available: V8Isolate[] = [];
  /** Isolates in use */
  private inUse: Set<V8Isolate> = new Set();
  /** Maximum pool size */
  private maxSize: number;
  /** Logger */
  private logger: Logger;
  /** Waiting queue */
  private queue: Array<{
    resolve: (isolate: V8Isolate) => void;
    reject: (error: Error) => void;
  }> = [];

  /**
   * Creates a new V8 isolate pool
   * @param config - Isolate configuration
   * @param maxSize - Maximum pool size
   */
  constructor(config: V8IsolateConfig, maxSize = 4) {
    this.config = config;
    this.maxSize = maxSize;
    this.logger = new Logger({
      level: 'info',
      prefix: '[V8IsolatePool]',
    });
  }

  /**
   * Initializes the pool
   * @param initialSize - Initial number of isolates
   */
  public async initialize(initialSize = 2): Promise<void> {
    this.logger.info(`Initializing pool with ${initialSize} isolates`);
    
    for (let i = 0; i < initialSize; i++) {
      const isolate = new V8Isolate(this.config);
      await isolate.initialize();
      this.available.push(isolate);
    }
    
    this.logger.info('Pool initialized');
  }

  /**
   * Acquires an isolate from the pool
   * @param timeout - Acquisition timeout
   * @returns Isolate instance
   */
  public async acquire(timeout = 30000): Promise<V8Isolate> {
    // Return available isolate
    if (this.available.length > 0) {
      const isolate = this.available.pop()!;
      this.inUse.add(isolate);
      return isolate;
    }
    
    // Create new isolate if under limit
    if (this.inUse.size < this.maxSize) {
      const isolate = new V8Isolate(this.config);
      await isolate.initialize();
      this.inUse.add(isolate);
      return isolate;
    }
    
    // Wait for available isolate
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex(q => q.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Isolate acquisition timeout'));
        }
      }, timeout);
      
      this.queue.push({
        resolve: (isolate) => {
          clearTimeout(timeoutId);
          resolve(isolate);
        },
        reject,
      });
    });
  }

  /**
   * Releases an isolate back to the pool
   * @param isolate - Isolate to release
   */
  public release(isolate: V8Isolate): void {
    if (!this.inUse.has(isolate)) {
      return;
    }
    
    this.inUse.delete(isolate);
    
    // Give to waiting request
    if (this.queue.length > 0) {
      const { resolve } = this.queue.shift()!;
      this.inUse.add(isolate);
      resolve(isolate);
    } else {
      this.available.push(isolate);
    }
  }

  /**
   * Gets pool statistics
   * @returns Pool statistics
   */
  public getStats(): {
    available: number;
    inUse: number;
    total: number;
    waiting: number;
  } {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
      waiting: this.queue.length,
    };
  }

  /**
   * Disposes all isolates in the pool
   */
  public async dispose(): Promise<void> {
    this.logger.info('Disposing pool');
    
    // Reject all waiting
    for (const { reject } of this.queue) {
      reject(new Error('Pool disposed'));
    }
    this.queue = [];
    
    // Dispose all isolates
    const allIsolates = [...this.available, ...this.inUse];
    await Promise.all(allIsolates.map(isolate => isolate.dispose()));
    
    this.available = [];
    this.inUse.clear();
    
    this.logger.info('Pool disposed');
  }
}

export default V8Isolate;

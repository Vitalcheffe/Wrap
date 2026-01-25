/**
 * @fileoverview V8 Isolate Sandbox Implementation
 * @description Secure JavaScript execution using isolated-vm
 * @module @wrap-nebula/core/sandbox/v8
 * @version 1.0.0
 * @author WRAP Nebula Team
 * @license MIT
 */

import type {
  SandboxConfig,
  SandboxExecutionOptions,
  SandboxExecutionResult,
  V8SandboxConfig,
  ResourceUsage,
} from '../types';
import { Sandbox } from './index';

// ============================================================================
// Types
// ============================================================================

/**
 * Isolated-vm module interface (lazy loaded).
 */
interface IsolatedVM {
  Isolate: typeof Isolate;
  DefaultIsolate: typeof Isolate;
  Copy: typeof Copy;
  ExternalCopy: typeof ExternalCopy;
}

/**
 * Isolate class from isolated-vm.
 */
interface Isolate {
  new (options?: IsolateOptions): IsolateInstance;
}

/**
 * Isolate instance interface.
 */
interface IsolateInstance {
  createContext(): Promise<Context>;
  createSyncSnapshot(): Buffer;
  compileScript(code: string, options?: ScriptOptions): Promise<Script>;
  compileScriptSync(code: string, options?: ScriptOptions): Script;
  dispose(): void;
  getHeapStatistics(): HeapStatistics;
  memoryUsage: {
    external: number;
    heapTotal: number;
    heapUsed: number;
    mallocatedMemory: number;
    mallocSize: number;
  };
  isInUse: boolean;
}

/**
 * Isolate options.
 */
interface IsolateOptions {
  memoryLimit?: number;
  inspector?: boolean;
  snapshot?: Buffer;
}

/**
 * Context interface.
 */
interface Context {
  global: Reference;
  release(): void;
  evalIgnored(code: string): void;
}

/**
 * Reference interface.
 */
interface Reference {
  get(key: string): Promise<Reference>;
  set(key: string, value: unknown): Promise<void>;
  setSync(key: string, value: unknown): void;
  getSync(key: string): Reference;
  apply(receiver: Reference | undefined, args: unknown[]): Promise<unknown>;
  applySync(receiver: Reference | undefined, args: unknown[]): unknown;
  type: string;
  typeof: string;
  copy(): unknown;
  copyInto(): unknown;
  release(): void;
}

/**
 * Script interface.
 */
interface Script {
  run(context: Context, options?: RunOptions): Promise<unknown>;
  runSync(context: Context, options?: RunOptions): unknown;
  release(): void;
}

/**
 * Script options.
 */
interface ScriptOptions {
  filename?: string;
  lineOffset?: number;
  columnOffset?: number;
  cachedData?: Buffer;
  produceCachedData?: boolean;
}

/**
 * Run options.
 */
interface RunOptions {
  timeout?: number;
  promise?: boolean;
  release?: boolean;
  reference?: boolean;
  copy?: boolean;
  result?: 'promise' | 'sync';
}

/**
 * Heap statistics.
 */
interface HeapStatistics {
  totalHeapSize: number;
  totalHeapSizeExecutable: number;
  totalPhysicalSize: number;
  totalAvailableSize: number;
  usedHeapSize: number;
  heapSizeLimit: number;
  mallocedMemory: number;
  peakMallocedMemory: number;
  numberOfNativeContexts: number;
  numberOfDetachedContexts: number;
}

/**
 * Copy class interface.
 */
declare const Copy: {
  new (value: unknown): CopyInstance;
};

/**
 * External copy instance.
 */
interface CopyInstance {
  copyInto(): unknown;
  release(): void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default memory limit for V8 isolates (64MB).
 */
const DEFAULT_MEMORY_LIMIT = 64 * 1024 * 1024;

/**
 * Default script timeout in milliseconds.
 */
const DEFAULT_TIMEOUT = 5000;

/**
 * Maximum number of cached scripts.
 */
const MAX_CACHED_SCRIPTS = 100;

/**
 * Script cache entry.
 */
interface CachedScript {
  script: Script;
  lastUsed: number;
  useCount: number;
}

// ============================================================================
// V8Sandbox Class
// ============================================================================

/**
 * V8 isolate-based sandbox implementation.
 * Provides secure JavaScript execution using isolated-vm.
 * 
 * @example
 * ```typescript
 * const sandbox = new V8Sandbox({
 *   id: 'my-v8-sandbox',
 *   type: 'v8',
 *   memoryLimit: 128 * 1024 * 1024, // 128MB
 *   timeout: 30000, // 30 seconds
 * });
 * 
 * await sandbox.initialize();
 * 
 * const result = await sandbox.execute({
 *   code: 'const x = 1 + 1; return x;',
 * });
 * 
 * console.log(result.result); // 2
 * 
 * await sandbox.destroy();
 * ```
 */
export class V8Sandbox extends Sandbox {
  private isolate: IsolateInstance | null = null;
  private context: Context | null = null;
  private ivm: IsolatedVM | null = null;
  private scriptCache: Map<string, CachedScript> = new Map();
  private snapshot: Buffer | null = null;
  private config: V8SandboxConfig;
  private startTime: number = 0;

  /**
   * Create a new V8 sandbox.
   * @param config - Sandbox configuration
   */
  constructor(config: SandboxConfig) {
    super(config);
    this.config = config as V8SandboxConfig;
  }

  /**
   * Initialize the V8 isolate.
   */
  protected async doInitialize(): Promise<void> {
    // Lazy load isolated-vm
    this.ivm = await this.loadIsolatedVM();

    // Create isolate with memory limit
    const memoryLimit = Math.floor(
      (this.config.memoryLimit ?? DEFAULT_MEMORY_LIMIT) / (1024 * 1024)
    );

    const isolateOptions: IsolateOptions = {
      memoryLimit,
      inspector: this.config.enableInspector ?? false,
    };

    // Use snapshot if available
    if (this.snapshot) {
      isolateOptions.snapshot = this.snapshot;
    }

    this.isolate = new this.ivm.Isolate(isolateOptions);

    // Create context
    this.context = await this.isolate.createContext();

    // Set up global environment
    await this.setupGlobalEnvironment();

    // Run preload scripts
    await this.runPreloadScripts();

    this.startTime = Date.now();
  }

  /**
   * Execute JavaScript code in the isolate.
   * @param options - Execution options
   * @param signal - Abort signal
   */
  protected async doExecute(
    options: SandboxExecutionOptions,
    signal: AbortSignal
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();

    if (!this.isolate || !this.context) {
      return {
        success: false,
        executionTime: 0,
        error: {
          name: 'SandboxError',
          message: 'Sandbox not initialized',
        },
      };
    }

    try {
      // Check for abort
      if (signal.aborted) {
        throw new Error('Execution aborted');
      }

      // Wrap code in a function if not already
      const code = this.wrapCode(options.code);

      // Get or compile script
      const script = await this.getOrCompileScript(code, {
        filename: options.workingDirectory ?? 'sandbox.js',
      });

      // Set up execution timeout
      const timeout = options.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT;

      // Execute the script
      const result = await script.run(this.context!, {
        timeout: timeout / 1000, // isolated-vm uses seconds
        promise: true,
      });

      // Update resource usage
      const heapStats = this.isolate.getHeapStatistics();
      this.updateResources({
        memoryUsed: heapStats.usedHeapSize,
        peakMemory: heapStats.heapSizeLimit,
      });

      // Check for abort again after execution
      if (signal.aborted) {
        throw new Error('Execution aborted');
      }

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        result: this.extractResult(result),
        executionTime,
        resources: {
          memoryUsed: heapStats.usedHeapSize,
          cpuTime: executionTime,
        },
      };
    } catch (error) {
      const err = error as Error;
      const executionTime = Date.now() - startTime;

      // Handle specific error types
      let errorCode = 'ExecutionError';
      let errorMessage = err.message;

      if (err.message.includes('timeout')) {
        errorCode = 'TimeoutError';
        errorMessage = `Script execution timed out after ${options.timeout ?? this.config.timeout}ms`;
      } else if (err.message.includes('memory')) {
        errorCode = 'MemoryError';
        errorMessage = 'Script exceeded memory limit';
      } else if (err.message.includes('aborted')) {
        errorCode = 'AbortError';
        errorMessage = 'Script execution was aborted';
      }

      return {
        success: false,
        executionTime,
        error: {
          name: errorCode,
          message: errorMessage,
          stack: err.stack,
          code: errorCode,
        },
      };
    }
  }

  /**
   * Pause execution (not supported for V8).
   */
  protected async doPause(): Promise<void> {
    throw new Error('V8 sandbox does not support pausing mid-execution');
  }

  /**
   * Resume execution (not supported for V8).
   */
  protected async doResume(): Promise<void> {
    throw new Error('V8 sandbox does not support resuming');
  }

  /**
   * Destroy the isolate and clean up resources.
   */
  protected async doDestroy(): Promise<void> {
    // Clear script cache
    for (const cached of this.scriptCache.values()) {
      try {
        cached.script.release();
      } catch {
        // Ignore release errors
      }
    }
    this.scriptCache.clear();

    // Release context
    if (this.context) {
      try {
        this.context.release();
      } catch {
        // Ignore release errors
      }
      this.context = null;
    }

    // Dispose isolate
    if (this.isolate) {
      try {
        this.isolate.dispose();
      } catch {
        // Ignore dispose errors
      }
      this.isolate = null;
    }

    this.ivm = null;
  }

  /**
   * Kill the isolate immediately.
   */
  protected async doKill(): Promise<void> {
    await this.doDestroy();
  }

  /**
   * Create a snapshot of the isolate state.
   */
  protected async doCreateSnapshot(): Promise<unknown> {
    if (!this.isolate) {
      throw new Error('Isolate not initialized');
    }

    try {
      const snapshot = this.isolate.createSyncSnapshot();
      return {
        snapshot,
        timestamp: Date.now(),
        heapStats: this.isolate.getHeapStatistics(),
      };
    } catch (error) {
      throw new Error(`Failed to create snapshot: ${(error as Error).message}`);
    }
  }

  /**
   * Restore from a snapshot.
   */
  protected async doRestoreSnapshot(snapshot: unknown): Promise<void> {
    const snap = snapshot as { snapshot: Buffer };

    // Destroy current isolate
    await this.doDestroy();

    // Store snapshot for next initialization
    this.snapshot = snap.snapshot;

    // Re-initialize with snapshot
    await this.doInitialize();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Lazy load isolated-vm module.
   */
  private async loadIsolatedVM(): Promise<IsolatedVM> {
    try {
      // Dynamic import for isolated-vm
      const ivm = await import('isolated-vm');
      return ivm as unknown as IsolatedVM;
    } catch (error) {
      throw new Error(
        'isolated-vm is not installed. Install it with: npm install isolated-vm'
      );
    }
  }

  /**
   * Set up the global environment in the context.
   */
  private async setupGlobalEnvironment(): Promise<void> {
    if (!this.context || !this.ivm) return;

    const global = this.context.global;

    // Set up console
    await this.setupConsole(global);

    // Set up basic globals
    await this.setupGlobals(global);

    // Set up environment variables
    await this.setupEnvironment(global);

    // Set up custom globals from config
    if (this.config.options?.globals) {
      await this.setupCustomGlobals(global, this.config.options.globals as Record<string, unknown>);
    }
  }

  /**
   * Set up console in the sandbox.
   */
  private async setupConsole(global: Reference): Promise<void> {
    if (!this.ivm) return;

    const consoleObj: Record<string, (message: string) => void> = {
      log: (message: string) => this.log('log', message),
      info: (message: string) => this.log('info', message),
      warn: (message: string) => this.log('warn', message),
      error: (message: string) => this.log('error', message),
      debug: (message: string) => this.log('debug', message),
      trace: (message: string) => this.log('trace', message),
    };

    // Create a copy of console object
    const consoleCopy = new this.ivm.Copy(consoleObj);
    global.setSync('console', consoleCopy);
  }

  /**
   * Set up basic global objects.
   */
  private async setupGlobals(global: Reference): Promise<void> {
    // Set up global helper functions
    const helpers = `
      globalThis.global = globalThis;
      
      // Safe JSON operations
      globalThis.safeJSON = {
        parse: function(str) {
          try {
            return JSON.parse(str);
          } catch (e) {
            return null;
          }
        },
        stringify: function(obj) {
          try {
            return JSON.stringify(obj);
          } catch (e) {
            return '{}';
          }
        }
      };

      // UUID v4 generation
      globalThis.generateUUID = function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      };

      // Sleep function
      globalThis.sleep = function(ms) {
        return new Promise(function(resolve) {
          setTimeout(resolve, ms);
        });
      };

      // Safe eval (with timeout)
      globalThis.safeEval = function(code, timeout) {
        timeout = timeout || 1000;
        return eval(code);
      };
    `;

    if (this.isolate) {
      const script = await this.isolate.compileScript(helpers);
      await script.run(this.context!, { timeout: 1 });
      script.release();
    }
  }

  /**
   * Set up environment variables.
   */
  private async setupEnvironment(global: Reference): Promise<void> {
    if (!this.ivm) return;

    const envObj = { ...this.config.environment };
    const envCopy = new this.ivm.Copy(envObj);
    global.setSync('process', new this.ivm.Copy({ env: envCopy }));
  }

  /**
   * Set up custom globals.
   */
  private async setupCustomGlobals(
    global: Reference,
    globals: Record<string, unknown>
  ): Promise<void> {
    if (!this.ivm) return;

    for (const [key, value] of Object.entries(globals)) {
      if (typeof value === 'function') {
        // Wrap function for safe calling
        const wrapper = async (...args: unknown[]) => {
          try {
            return await value(...args);
          } catch (error) {
            return { error: (error as Error).message };
          }
        };
        const wrappedCopy = new this.ivm.Copy(wrapper);
        global.setSync(key, wrappedCopy);
      } else if (typeof value === 'object' && value !== null) {
        const valueCopy = new this.ivm.Copy(value);
        global.setSync(key, valueCopy);
      } else {
        global.setSync(key, value);
      }
    }
  }

  /**
   * Run preload scripts.
   */
  private async runPreloadScripts(): Promise<void> {
    if (!this.config.preloadScripts || !this.isolate || !this.context) return;

    for (const script of this.config.preloadScripts) {
      try {
        const compiled = await this.isolate.compileScript(script);
        await compiled.run(this.context, { timeout: 5 });
        compiled.release();
      } catch (error) {
        this.log('error', `Failed to run preload script: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Wrap code to ensure it returns a value.
   */
  private wrapCode(code: string): string {
    // Check if code is already an expression or IIFE
    const trimmed = code.trim();
    
    // If it's already wrapped or is a simple expression, return as-is
    if (
      trimmed.startsWith('(function') ||
      trimmed.startsWith('(()') ||
      trimmed.startsWith('(async') ||
      trimmed.startsWith('class ') ||
      trimmed.startsWith('function ') ||
      trimmed.startsWith('async function') ||
      (!trimmed.includes('\n') && !trimmed.includes(';') && !trimmed.startsWith('const') && 
       !trimmed.startsWith('let') && !trimmed.startsWith('var') && !trimmed.startsWith('return'))
    ) {
      // For single expressions, wrap in return
      if (!trimmed.includes('\n') && !trimmed.includes(';')) {
        return `(function() { return (${trimmed}); })()`;
      }
      return code;
    }

    // Wrap in a function that can return the last expression
    return `(function() {\n${code}\n})()`;
  }

  /**
   * Get a cached script or compile a new one.
   */
  private async getOrCompileScript(
    code: string,
    options: ScriptOptions
  ): Promise<Script> {
    const cacheKey = this.getCacheKey(code);

    // Check cache
    const cached = this.scriptCache.get(cacheKey);
    if (cached) {
      cached.lastUsed = Date.now();
      cached.useCount++;
      return cached.script;
    }

    // Compile new script
    if (!this.isolate) {
      throw new Error('Isolate not initialized');
    }

    const script = await this.isolate.compileScript(code, options);

    // Add to cache (with eviction if full)
    if (this.scriptCache.size >= MAX_CACHED_SCRIPTS) {
      this.evictFromCache();
    }

    this.scriptCache.set(cacheKey, {
      script,
      lastUsed: Date.now(),
      useCount: 0,
    });

    return script;
  }

  /**
   * Generate a cache key for code.
   */
  private getCacheKey(code: string): string {
    // Simple hash function for caching
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Evict least recently used script from cache.
   */
  private evictFromCache(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, cached] of this.scriptCache) {
      if (cached.lastUsed < oldestTime) {
        oldestTime = cached.lastUsed;
        oldest = key;
      }
    }

    if (oldest) {
      const cached = this.scriptCache.get(oldest);
      if (cached) {
        cached.script.release();
      }
      this.scriptCache.delete(oldest);
    }
  }

  /**
   * Extract result from isolated-vm reference.
   */
  private extractResult(result: unknown): unknown {
    if (result === null || result === undefined) {
      return result;
    }

    // Handle references
    if (typeof result === 'object' && result !== null) {
      const ref = result as Reference;
      if (typeof ref.copy === 'function') {
        try {
          return ref.copy();
        } catch {
          return undefined;
        }
      }
    }

    return result;
  }

  /**
   * Log a message.
   */
  private log(level: string, message: string): void {
    // In production, this would integrate with the logger
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [V8Sandbox] [${level}] ${message}`);
  }

  // ============================================================================
  // Public Utility Methods
  // ============================================================================

  /**
   * Get current heap statistics.
   */
  getHeapStatistics(): HeapStatistics | null {
    if (!this.isolate) return null;
    return this.isolate.getHeapStatistics();
  }

  /**
   * Get memory usage.
   */
  getMemoryUsage(): { external: number; heapTotal: number; heapUsed: number } | null {
    if (!this.isolate) return null;
    return this.isolate.memoryUsage;
  }

  /**
   * Check if the isolate is healthy.
   */
  isIsolateHealthy(): boolean {
    if (!this.isolate) return false;
    return this.isolate.isInUse;
  }

  /**
   * Clear the script cache.
   */
  clearScriptCache(): void {
    for (const cached of this.scriptCache.values()) {
      try {
        cached.script.release();
      } catch {
        // Ignore errors
      }
    }
    this.scriptCache.clear();
  }

  /**
   * Get script cache statistics.
   */
  getCacheStats(): { size: number; hitRate: number } {
    let totalUses = 0;
    let reused = 0;

    for (const cached of this.scriptCache.values()) {
      totalUses += cached.useCount;
      if (cached.useCount > 0) reused++;
    }

    return {
      size: this.scriptCache.size,
      hitRate: totalUses > 0 ? reused / this.scriptCache.size : 0,
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  V8Sandbox,
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_TIMEOUT,
  MAX_CACHED_SCRIPTS,
};

export type {
  IsolatedVM,
  Isolate,
  IsolateInstance,
  IsolateOptions,
  Context,
  Reference,
  Script,
  ScriptOptions,
  RunOptions,
  HeapStatistics,
  CopyInstance,
  CachedScript,
};

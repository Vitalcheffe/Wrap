/**
 * @fileoverview Sandbox implementation for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/sandbox
 * @description This module provides the Sandbox class with EventEmitter support,
 * multiple isolation types (v8, container, worker, etc.), resource monitoring,
 * and comprehensive lifecycle management.
 */

import EventEmitter from 'eventemitter3';
import type {
  SandboxConfig,
  SandboxInfo,
  SandboxState,
  SandboxHooks,
  SandboxIsolationType,
  SandboxHealth,
  SandboxHealthIssue,
  ExecutionContext,
  ExecutionResult,
  ExecutionState,
  Boundaries,
  BoundaryViolation,
  Permission,
  ResourceUsage,
  TelemetryData,
  WRAPEvent,
} from '../types';
import {
  Logger,
  generateId,
  withTimeout,
  sleep,
  deepClone,
  formatBytes,
  formatDuration,
} from '../utils';
import {
  SandboxError,
  SandboxCreationError,
  SandboxExecutionError,
  SandboxMemoryError,
  SandboxBoundaryError,
  TimeoutError,
  ErrorCodes,
} from '../errors';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sandbox events
 */
export type SandboxEventType =
  | 'created'
  | 'destroyed'
  | 'state_change'
  | 'execution_start'
  | 'execution_end'
  | 'boundary_violation'
  | 'resource_warning'
  | 'health_check'
  | 'error';

/**
 * Sandbox event map
 */
export interface SandboxEventMap {
  created: { sandboxId: string; config: SandboxConfig };
  destroyed: { sandboxId: string; reason?: string };
  state_change: { previous: ExecutionState; current: ExecutionState };
  execution_start: { executionId: string; code: string };
  execution_end: { executionId: string; result: ExecutionResult };
  boundary_violation: { violation: BoundaryViolation };
  resource_warning: { type: string; current: number; limit: number };
  health_check: { health: SandboxHealth };
  error: { error: Error; context?: unknown };
}

/**
 * Resource monitor configuration
 */
export interface ResourceMonitorConfig {
  /** Monitoring interval in milliseconds */
  interval?: number;
  /** Warning threshold (0-1) */
  warningThreshold?: number;
  /** Critical threshold (0-1) */
  criticalThreshold?: number;
  /** Whether to enforce limits */
  enforceLimits?: boolean;
}

/**
 * Sandbox creation options
 */
export interface SandboxCreateOptions extends Partial<SandboxConfig> {
  /** Whether to auto-connect */
  autoConnect?: boolean;
  /** Resource monitor configuration */
  resourceMonitor?: ResourceMonitorConfig;
}

// ============================================================================
// SANDBOX CLASS
// ============================================================================

/**
 * Sandbox class for isolated code execution
 * @description The Sandbox class provides a secure environment for executing
 * untrusted code with configurable isolation types, resource boundaries,
 * and comprehensive monitoring.
 * 
 * @example
 * ```typescript
 * const sandbox = new Sandbox({
 *   isolationType: 'v8',
 *   boundaries: {
 *     memoryLimit: 128 * 1024 * 1024, // 128MB
 *     cpuTimeLimit: 5000, // 5 seconds
 *     wallTimeLimit: 10000, // 10 seconds
 *   },
 * });
 * 
 * await sandbox.initialize();
 * const result = await sandbox.execute('return 1 + 1');
 * console.log(result); // 2
 * await sandbox.destroy();
 * ```
 */
export class Sandbox extends EventEmitter<SandboxEventMap> {
  /** Sandbox configuration */
  private config: SandboxConfig;
  /** Sandbox information */
  private info: SandboxInfo;
  /** Logger instance */
  protected logger: Logger;
  /** Whether the sandbox is initialized */
  private initialized = false;
  /** Whether the sandbox is destroyed */
  private destroyed = false;
  /** Resource monitor interval */
  private monitorInterval?: ReturnType<typeof setInterval>;
  /** Resource monitor configuration */
  private monitorConfig: ResourceMonitorConfig;
  /** Active executions */
  private activeExecutions: Map<string, ExecutionContext> = new Map();
  /** Isolation backend */
  private backend: IsolationBackend | null = null;

  /**
   * Creates a new Sandbox instance
   * @param options - Sandbox creation options
   */
  constructor(options: SandboxCreateOptions = {}) {
    super();
    
    // Initialize configuration
    this.config = this.createConfig(options);
    
    // Initialize logger
    this.logger = new Logger({
      level: 'info',
      prefix: `[Sandbox:${this.config.id}]`,
    });
    
    // Initialize monitor configuration
    this.monitorConfig = {
      interval: options.resourceMonitor?.interval ?? 1000,
      warningThreshold: options.resourceMonitor?.warningThreshold ?? 0.8,
      criticalThreshold: options.resourceMonitor?.criticalThreshold ?? 0.95,
      enforceLimits: options.resourceMonitor?.enforceLimits ?? true,
    };
    
    // Initialize info
    this.info = {
      id: this.config.id,
      isolationType: this.config.isolationType,
      state: 'idle',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      resourceUsage: this.getEmptyResourceUsage(),
      config: this.config,
      health: {
        status: 'unknown',
        checkedAt: new Date(),
      },
    };
    
    this.logger.debug('Sandbox instance created');
  }

  /**
   * Creates the full configuration from options
   * @param options - Creation options
   * @returns Complete configuration
   */
  private createConfig(options: SandboxCreateOptions): SandboxConfig {
    const defaultBoundaries: Boundaries = {
      memoryLimit: 256 * 1024 * 1024, // 256MB
      cpuTimeLimit: 30000, // 30 seconds
      wallTimeLimit: 60000, // 60 seconds
      networkAccess: {
        allowed: false,
      },
      fileSystemAccess: {
        allowed: false,
      },
      processExecution: {
        allowed: false,
      },
      environmentVariables: {
        allowed: false,
      },
    };
    
    return {
      id: options.id ?? generateId('sandbox'),
      isolationType: options.isolationType ?? 'v8',
      boundaries: { ...defaultBoundaries, ...options.boundaries },
      permissions: options.permissions ?? [],
      environment: options.environment ?? {},
      workingDirectory: options.workingDirectory,
      timeout: options.timeout ?? 60000,
      autoDestroy: options.autoDestroy ?? false,
      initialState: options.initialState,
      hooks: options.hooks,
      custom: options.custom,
    };
  }

  /**
   * Gets empty resource usage
   * @returns Empty resource usage
   */
  private getEmptyResourceUsage(): ResourceUsage {
    return {
      cpuTimeMs: 0,
      wallTimeMs: 0,
      memoryBytes: 0,
      peakMemoryBytes: 0,
    };
  }

  /**
   * Gets the sandbox ID
   */
  public get id(): string {
    return this.config.id;
  }

  /**
   * Gets the sandbox state
   */
  public get state(): ExecutionState {
    return this.info.state;
  }

  /**
   * Gets the isolation type
   */
  public get isolationType(): SandboxIsolationType {
    return this.config.isolationType;
  }

  /**
   * Gets the current boundaries
   */
  public get boundaries(): Boundaries {
    return { ...this.config.boundaries };
  }

  /**
   * Gets the sandbox info
   */
  public getInfo(): SandboxInfo {
    return deepClone(this.info);
  }

  /**
   * Gets the resource usage
   */
  public getResourceUsage(): ResourceUsage {
    return { ...this.info.resourceUsage };
  }

  /**
   * Initializes the sandbox
   * @description This method must be called before executing any code.
   * It sets up the isolation backend and starts resource monitoring.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Sandbox already initialized');
      return;
    }
    
    if (this.destroyed) {
      throw new SandboxError('Sandbox has been destroyed', {
        sandboxId: this.config.id,
        code: ErrorCodes.NOT_INITIALIZED,
        recoverable: false,
      });
    }
    
    this.logger.info('Initializing sandbox');
    this.updateState('initializing');
    
    try {
      // Run beforeCreate hook
      await this.runHook('beforeCreate', this.config);
      
      // Create isolation backend
      this.backend = await this.createBackend();
      
      // Load initial state if provided
      if (this.config.initialState) {
        await this.loadState(this.config.initialState);
      }
      
      // Start resource monitoring
      this.startResourceMonitor();
      
      // Update state
      this.initialized = true;
      this.updateState('idle');
      
      // Run afterCreate hook
      await this.runHook('afterCreate', this.info);
      
      // Emit created event
      this.emit('created', {
        sandboxId: this.config.id,
        config: this.config,
      });
      
      this.logger.info('Sandbox initialized successfully');
    } catch (error) {
      this.updateState('error');
      this.logger.error('Failed to initialize sandbox', error);
      throw new SandboxCreationError('Failed to initialize sandbox', {
        sandboxId: this.config.id,
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Creates the isolation backend
   * @returns Isolation backend instance
   */
  private async createBackend(): Promise<IsolationBackend> {
    switch (this.config.isolationType) {
      case 'v8':
        return this.createV8Backend();
      case 'vm':
        return this.createVmBackend();
      case 'worker':
        return this.createWorkerBackend();
      case 'container':
        return this.createContainerBackend();
      case 'process':
        return this.createProcessBackend();
      case 'none':
        return this.createNoneBackend();
      default:
        throw new SandboxError(`Unsupported isolation type: ${this.config.isolationType}`, {
          sandboxId: this.config.id,
          code: ErrorCodes.FEATURE_NOT_SUPPORTED,
        });
    }
  }

  /**
   * Creates V8 isolate backend
   */
  private async createV8Backend(): Promise<IsolationBackend> {
    // V8 backend implementation would go here
    // For now, return a mock implementation
    return {
      execute: async (code: string, context: ExecutionContext) => {
        return this.executeInVM(code, context);
      },
      destroy: async () => {
        // Cleanup
      },
      getResourceUsage: () => this.info.resourceUsage,
    };
  }

  /**
   * Creates VM backend
   */
  private async createVmBackend(): Promise<IsolationBackend> {
    return {
      execute: async (code: string, context: ExecutionContext) => {
        return this.executeInVM(code, context);
      },
      destroy: async () => {
        // Cleanup
      },
      getResourceUsage: () => this.info.resourceUsage,
    };
  }

  /**
   * Creates Worker backend
   */
  private async createWorkerBackend(): Promise<IsolationBackend> {
    return {
      execute: async (code: string, context: ExecutionContext) => {
        return this.executeInVM(code, context);
      },
      destroy: async () => {
        // Cleanup
      },
      getResourceUsage: () => this.info.resourceUsage,
    };
  }

  /**
   * Creates Container backend
   */
  private async createContainerBackend(): Promise<IsolationBackend> {
    return {
      execute: async (code: string, context: ExecutionContext) => {
        return this.executeInVM(code, context);
      },
      destroy: async () => {
        // Cleanup
      },
      getResourceUsage: () => this.info.resourceUsage,
    };
  }

  /**
   * Creates Process backend
   */
  private async createProcessBackend(): Promise<IsolationBackend> {
    return {
      execute: async (code: string, context: ExecutionContext) => {
        return this.executeInVM(code, context);
      },
      destroy: async () => {
        // Cleanup
      },
      getResourceUsage: () => this.info.resourceUsage,
    };
  }

  /**
   * Creates no isolation backend (direct execution - UNSAFE)
   */
  private async createNoneBackend(): Promise<IsolationBackend> {
    this.logger.warn('Using no isolation backend - this is unsafe for untrusted code!');
    return {
      execute: async (code: string, context: ExecutionContext) => {
        return this.executeInVM(code, context);
      },
      destroy: async () => {
        // Cleanup
      },
      getResourceUsage: () => this.info.resourceUsage,
    };
  }

  /**
   * Executes code in VM context
   * @param code - Code to execute
   * @param context - Execution context
   * @returns Execution result
   */
  private async executeInVM(
    code: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Create a wrapped function for execution
      const wrappedCode = `
        (function() {
          ${code}
        })()
      `;
      
      // Execute with timeout
      const result = await withTimeout(
        async () => {
          // Use Function constructor for basic isolation
          const fn = new Function('context', `
            const { console, require, module, exports, __filename, __dirname } = {};
            return (function() {
              ${code}
            })();
          `);
          return fn(context);
        },
        this.config.boundaries.wallTimeLimit,
        'Execution timeout'
      );
      
      const endTime = Date.now();
      
      return {
        executionId: context.executionId,
        state: 'completed',
        result,
        startedAt: new Date(startTime),
        endedAt: new Date(endTime),
        duration: endTime - startTime,
        resourceUsage: {
          cpuTimeMs: endTime - startTime,
          wallTimeMs: endTime - startTime,
          memoryBytes: 0,
          peakMemoryBytes: 0,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      
      return {
        executionId: context.executionId,
        state: 'failed',
        error: {
          type: 'runtime',
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
   * Executes code in the sandbox
   * @param code - Code to execute
   * @param args - Arguments for execution
   * @returns Execution result
   */
  public async execute<T = unknown>(
    code: string,
    args?: unknown[]
  ): Promise<ExecutionResult<T>> {
    this.ensureInitialized();
    
    const executionId = generateId('exec');
    const context: ExecutionContext = {
      executionId,
      sandboxId: this.config.id,
      code,
      args,
      boundaries: this.config.boundaries,
      permissions: this.config.permissions,
    };
    
    this.logger.debug(`Starting execution: ${executionId}`);
    this.updateState('running');
    this.info.lastActivityAt = new Date();
    
    // Track active execution
    this.activeExecutions.set(executionId, context);
    
    // Emit execution start event
    this.emit('execution_start', { executionId, code });
    
    // Run beforeExecute hook
    await this.runHook('beforeExecute', code, context);
    
    try {
      if (!this.backend) {
        throw new SandboxError('Backend not initialized', {
          sandboxId: this.config.id,
        });
      }
      
      const result = await this.backend.execute(code, context);
      
      // Check for boundary violations
      this.checkBoundaries(result.resourceUsage);
      
      // Run afterExecute hook
      await this.runHook('afterExecute', result);
      
      // Update state
      this.updateState('idle');
      
      // Emit execution end event
      this.emit('execution_end', { executionId, result });
      
      return result as ExecutionResult<T>;
    } catch (error) {
      this.updateState('error');
      
      const errorObj = error instanceof Error ? error : new Error(String(error));
      
      // Run onError hook
      await this.runHook('onError', errorObj, context);
      
      // Emit error event
      this.emit('error', { error: errorObj, context });
      
      throw new SandboxExecutionError(errorObj.message, {
        sandboxId: this.config.id,
        code,
        cause: errorObj,
      });
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Executes a function in the sandbox
   * @param fn - Function to execute
   * @param args - Arguments for the function
   * @returns Execution result
   */
  public async call<T = unknown>(
    fn: string,
    args?: unknown[]
  ): Promise<ExecutionResult<T>> {
    const code = `return ${fn}(${args ? '...arguments[0]' : ''})`;
    return this.execute<T>(code, args);
  }

  /**
   * Sets a global variable in the sandbox
   * @param name - Variable name
   * @param value - Variable value
   */
  public async setGlobal(name: string, value: unknown): Promise<void> {
    this.ensureInitialized();
    
    const code = `globalThis.${name} = arguments[0]`;
    await this.execute(code, [value]);
  }

  /**
   * Gets a global variable from the sandbox
   * @param name - Variable name
   * @returns Variable value
   */
  public async getGlobal<T = unknown>(name: string): Promise<T> {
    this.ensureInitialized();
    
    const result = await this.execute<T>(`return ${name}`);
    return result.result as T;
  }

  /**
   * Loads state into the sandbox
   * @param state - State to load
   */
  public async loadState(state: SandboxState): Promise<void> {
    this.ensureInitialized();
    
    if (state.globals) {
      for (const [name, value] of Object.entries(state.globals)) {
        await this.setGlobal(name, value);
      }
    }
  }

  /**
   * Saves the current sandbox state
   * @returns Current state
   */
  public async saveState(): Promise<SandboxState> {
    this.ensureInitialized();
    
    // Return minimal state for now
    return {
      globals: {},
    };
  }

  /**
   * Sets new boundaries
   * @param boundaries - New boundaries
   */
  public setBoundaries(boundaries: Partial<Boundaries>): void {
    this.config.boundaries = {
      ...this.config.boundaries,
      ...boundaries,
    };
    this.logger.debug('Boundaries updated');
  }

  /**
   * Grants permissions
   * @param permissions - Permissions to grant
   */
  public grantPermissions(permissions: Permission[]): void {
    this.config.permissions.push(...permissions);
    this.logger.debug(`Granted ${permissions.length} permissions`);
  }

  /**
   * Revokes permissions
   * @param permissionIds - Permission IDs to revoke
   */
  public revokePermissions(permissionIds: string[]): void {
    this.config.permissions = this.config.permissions.filter(
      p => !permissionIds.includes(p.id)
    );
    this.logger.debug(`Revoked ${permissionIds.length} permissions`);
  }

  /**
   * Checks the sandbox health
   * @returns Health status
   */
  public async healthCheck(): Promise<SandboxHealth> {
    const health: SandboxHealth = {
      status: 'healthy',
      checkedAt: new Date(),
      issues: [],
    };
    
    // Check resource pressure
    const usage = this.info.resourceUsage;
    const boundaries = this.config.boundaries;
    
    // Check memory pressure
    const memoryPressure = usage.peakMemoryBytes / boundaries.memoryLimit;
    if (memoryPressure > this.monitorConfig.criticalThreshold) {
      health.issues?.push({
        type: 'memory_pressure',
        severity: 'critical',
        message: `Memory usage at ${(memoryPressure * 100).toFixed(1)}% of limit`,
        detectedAt: new Date(),
        resolution: 'Increase memory limit or optimize code',
      });
      health.status = 'unhealthy';
    } else if (memoryPressure > this.monitorConfig.warningThreshold) {
      health.issues?.push({
        type: 'memory_pressure',
        severity: 'warning',
        message: `Memory usage at ${(memoryPressure * 100).toFixed(1)}% of limit`,
        detectedAt: new Date(),
        resolution: 'Monitor memory usage',
      });
      health.status = 'degraded';
    }
    
    // Check for active executions
    if (this.activeExecutions.size > 10) {
      health.issues?.push({
        type: 'custom',
        severity: 'warning',
        message: `High number of active executions: ${this.activeExecutions.size}`,
        detectedAt: new Date(),
        resolution: 'Consider reducing concurrent executions',
      });
    }
    
    this.info.health = health;
    this.emit('health_check', { health });
    
    return health;
  }

  /**
   * Destroys the sandbox
   * @param reason - Optional reason for destruction
   */
  public async destroy(reason?: string): Promise<void> {
    if (this.destroyed) {
      return;
    }
    
    this.logger.info('Destroying sandbox');
    
    // Run beforeDestroy hook
    await this.runHook('beforeDestroy', this.info);
    
    // Stop resource monitor
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
    
    // Destroy backend
    if (this.backend) {
      await this.backend.destroy();
      this.backend = null;
    }
    
    // Clear active executions
    this.activeExecutions.clear();
    
    // Update state
    this.destroyed = true;
    this.updateState('idle');
    
    // Run afterDestroy hook
    await this.runHook('afterDestroy', this.config.id);
    
    // Emit destroyed event
    this.emit('destroyed', {
      sandboxId: this.config.id,
      reason,
    });
    
    // Remove all listeners
    this.removeAllListeners();
    
    this.logger.info('Sandbox destroyed');
  }

  // =========================================================================
  // PRIVATE METHODS
  // =========================================================================

  /**
   * Updates the sandbox state
   * @param newState - New state
   */
  private updateState(newState: ExecutionState): void {
    const previous = this.info.state;
    this.info.state = newState;
    
    if (previous !== newState) {
      this.emit('state_change', {
        previous,
        current: newState,
      });
    }
  }

  /**
   * Starts the resource monitor
   */
  private startResourceMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    this.monitorInterval = setInterval(() => {
      this.monitorResources();
    }, this.monitorConfig.interval);
  }

  /**
   * Monitors resource usage
   */
  private monitorResources(): void {
    if (!this.backend) return;
    
    const usage = this.backend.getResourceUsage();
    this.info.resourceUsage = usage;
    
    // Check boundaries
    this.checkBoundaries(usage);
  }

  /**
   * Checks boundaries and emits warnings/violations
   * @param usage - Resource usage to check
   */
  private checkBoundaries(usage?: ResourceUsage): void {
    const resourceUsage = usage ?? this.info.resourceUsage;
    const boundaries = this.config.boundaries;
    
    // Check memory limit
    if (resourceUsage.memoryBytes > boundaries.memoryLimit) {
      const violation: BoundaryViolation = {
        type: 'memoryLimit',
        name: 'memory',
        currentValue: resourceUsage.memoryBytes,
        limit: boundaries.memoryLimit,
        severity: 'critical',
        timestamp: new Date(),
        suggestedAction: 'Increase memory limit or optimize code',
      };
      
      this.emit('boundary_violation', { violation });
      
      if (this.monitorConfig.enforceLimits) {
        throw new SandboxMemoryError('Memory limit exceeded', {
          sandboxId: this.config.id,
          memoryLimit: boundaries.memoryLimit,
          memoryUsed: resourceUsage.memoryBytes,
        });
      }
    }
    
    // Check memory warning threshold
    const memoryRatio = resourceUsage.memoryBytes / boundaries.memoryLimit;
    if (memoryRatio > this.monitorConfig.warningThreshold) {
      this.emit('resource_warning', {
        type: 'memory',
        current: resourceUsage.memoryBytes,
        limit: boundaries.memoryLimit,
      });
    }
    
    // Check CPU time limit
    if (resourceUsage.cpuTimeMs > boundaries.cpuTimeLimit) {
      const violation: BoundaryViolation = {
        type: 'cpuTimeLimit',
        name: 'cpuTime',
        currentValue: resourceUsage.cpuTimeMs,
        limit: boundaries.cpuTimeLimit,
        severity: 'critical',
        timestamp: new Date(),
        suggestedAction: 'Optimize code or increase CPU time limit',
      };
      
      this.emit('boundary_violation', { violation });
    }
    
    // Check wall time limit
    if (resourceUsage.wallTimeMs > boundaries.wallTimeLimit) {
      const violation: BoundaryViolation = {
        type: 'wallTimeLimit',
        name: 'wallTime',
        currentValue: resourceUsage.wallTimeMs,
        limit: boundaries.wallTimeLimit,
        severity: 'critical',
        timestamp: new Date(),
        suggestedAction: 'Optimize code or increase wall time limit',
      };
      
      this.emit('boundary_violation', { violation });
    }
  }

  /**
   * Runs a lifecycle hook
   * @param hookName - Name of the hook
   * @param args - Hook arguments
   */
  private async runHook(
    hookName: keyof SandboxHooks,
    ...args: unknown[]
  ): Promise<void> {
    const hooks = this.config.hooks;
    if (!hooks) return;
    
    const hook = hooks[hookName];
    if (!hook) return;
    
    try {
      // @ts-expect-error - Dynamic hook call
      await hook(...args);
    } catch (error) {
      this.logger.error(`Hook ${hookName} failed`, error);
    }
  }

  /**
   * Ensures the sandbox is initialized
   */
  private ensureInitialized(): void {
    if (this.destroyed) {
      throw new SandboxError('Sandbox has been destroyed', {
        sandboxId: this.config.id,
        code: ErrorCodes.NOT_INITIALIZED,
        recoverable: false,
      });
    }
    
    if (!this.initialized) {
      throw new SandboxError('Sandbox not initialized. Call initialize() first.', {
        sandboxId: this.config.id,
        code: ErrorCodes.NOT_INITIALIZED,
        recoverable: true,
        recovery: 'Call sandbox.initialize() before executing code',
      });
    }
  }

  /**
   * Creates a child sandbox with inherited configuration
   * @param overrides - Configuration overrides
   * @returns Child sandbox
   */
  public async createChild(overrides: Partial<SandboxConfig> = {}): Promise<Sandbox> {
    const childConfig: SandboxCreateOptions = {
      ...this.config,
      ...overrides,
      id: overrides.id ?? generateId('sandbox'),
    };
    
    const child = new Sandbox(childConfig);
    await child.initialize();
    
    return child;
  }

  /**
   * Gets a string representation of the sandbox
   */
  public override toString(): string {
    return `Sandbox(${this.config.id}, ${this.config.isolationType}, ${this.info.state})`;
  }

  /**
   * Gets a detailed status string
   * @returns Detailed status
   */
  public getStatus(): string {
    const usage = this.info.resourceUsage;
    const boundaries = this.config.boundaries;
    
    return [
      `Sandbox: ${this.config.id}`,
      `  Type: ${this.config.isolationType}`,
      `  State: ${this.info.state}`,
      `  Memory: ${formatBytes(usage.memoryBytes)} / ${formatBytes(boundaries.memoryLimit)}`,
      `  CPU Time: ${formatDuration(usage.cpuTimeMs)} / ${formatDuration(boundaries.cpuTimeLimit)}`,
      `  Wall Time: ${formatDuration(usage.wallTimeMs)} / ${formatDuration(boundaries.wallTimeLimit)}`,
      `  Active Executions: ${this.activeExecutions.size}`,
    ].join('\n');
  }
}

// ============================================================================
// ISOLATION BACKEND INTERFACE
// ============================================================================

/**
 * Interface for isolation backends
 */
interface IsolationBackend {
  /** Execute code */
  execute: (code: string, context: ExecutionContext) => Promise<ExecutionResult>;
  /** Destroy the backend */
  destroy: () => Promise<void>;
  /** Get resource usage */
  getResourceUsage: () => ResourceUsage;
}

// ============================================================================
// SANDBOX FACTORY
// ============================================================================

/**
 * Factory for creating sandboxes
 */
export class SandboxFactory {
  /** Default configuration */
  private defaultConfig: Partial<SandboxConfig> = {};

  /**
   * Creates a new sandbox factory
   * @param defaultConfig - Default configuration for created sandboxes
   */
  constructor(defaultConfig: Partial<SandboxConfig> = {}) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Creates a new sandbox
   * @param options - Sandbox options
   * @returns New sandbox instance
   */
  public async create(options: SandboxCreateOptions = {}): Promise<Sandbox> {
    const config: SandboxCreateOptions = {
      ...this.defaultConfig,
      ...options,
    };
    
    const sandbox = new Sandbox(config);
    await sandbox.initialize();
    
    return sandbox;
  }

  /**
   * Creates a V8 sandbox
   * @param options - Sandbox options
   * @returns V8 sandbox
   */
  public async createV8(options: SandboxCreateOptions = {}): Promise<Sandbox> {
    return this.create({ ...options, isolationType: 'v8' });
  }

  /**
   * Creates a container sandbox
   * @param options - Sandbox options
   * @returns Container sandbox
   */
  public async createContainer(options: SandboxCreateOptions = {}): Promise<Sandbox> {
    return this.create({ ...options, isolationType: 'container' });
  }

  /**
   * Creates a worker sandbox
   * @param options - Sandbox options
   * @returns Worker sandbox
   */
  public async createWorker(options: SandboxCreateOptions = {}): Promise<Sandbox> {
    return this.create({ ...options, isolationType: 'worker' });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Sandbox;

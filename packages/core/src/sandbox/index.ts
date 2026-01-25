/**
 * WRAP Sandbox - Secure Execution Environment
 * @module @wrap/core/sandbox
 *
 * The Sandbox is the core isolation boundary for WRAP. It manages:
 * - Resource allocation and limits
 * - Permission enforcement
 * - Tool execution
 * - State management
 * - Telemetry collection
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import type {
  SandboxInfo,
  SandboxType,
  SandboxStatus,
  Boundaries,
  ResourceUsage,
  WRAP,
  ExecutionState,
  ExecutionStatus,
  ToolRegistry,
  AgentContext,
  OutputSchema,
  StreamEvent,
  StreamEventType,
  Message,
  Tool,
  Permission,
  VirtualFileSystem,
  NetworkAccess,
  Logger,
  ExecutionError,
  TelemetryData,
  Span,
  Metric,
  LogEntry
} from '../types';

// ============================================================================
// SANDBOX EVENTS
// ============================================================================

/**
 * Events emitted by the Sandbox during its lifecycle
 */
export interface SandboxEvents {
  'status:changed': (status: SandboxStatus, previous: SandboxStatus) => void;
  'resource:warning': (resource: keyof ResourceUsage, usage: number, limit: number) => void;
  'resource:exceeded': (resource: keyof ResourceUsage, usage: number, limit: number) => void;
  'permission:denied': (permission: Permission, context: string) => void;
  'boundary:violation': (boundary: string, details: Record<string, unknown>) => void;
  'execution:start': (wrap: WRAP) => void;
  'execution:end': (wrap: WRAP, result: unknown) => void;
  'execution:error': (wrap: WRAP, error: Error) => void;
  'tool:call': (toolName: string, input: unknown) => void;
  'tool:result': (toolName: string, output: unknown) => void;
  'message:sent': (message: Message) => void;
  'message:received': (message: Message) => void;
  'stream:event': (event: StreamEvent) => void;
  'checkpoint:created': (checkpointId: string) => void;
  'cleanup:start': () => void;
  'cleanup:end': () => void;
}

// ============================================================================
// SANDBOX CONFIGURATION
// ============================================================================

/**
 * Configuration for creating a new Sandbox
 */
export interface SandboxConfig {
  /** Unique sandbox identifier */
  id?: string;
  /** Type of isolation */
  type: SandboxType;
  /** Security boundaries */
  boundaries: Boundaries;
  /** Enable detailed logging */
  debug?: boolean;
  /** Enable telemetry collection */
  telemetry?: boolean;
  /** Enable checkpointing for resumption */
  checkpointing?: boolean;
  /** Checkpoint interval in milliseconds */
  checkpointInterval?: number;
  /** Maximum execution time in milliseconds */
  timeout?: number;
  /** Callback for stream events */
  onStream?: (event: StreamEvent) => void;
  /** Logger instance */
  logger?: Logger;
  /** Pre-allocated resources */
  resources?: Partial<ResourceAllocation>;
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
  /** Mount points for filesystem */
  mounts?: MountConfig[];
  /** Network mode */
  networkMode?: 'none' | 'bridge' | 'host';
}

/**
 * Resource allocation configuration
 */
export interface ResourceAllocation {
  memoryMB: number;
  cpuShares: number;
  diskMB: number;
  networkMbps: number;
}

/**
 * Mount configuration for filesystem
 */
export interface MountConfig {
  source: string;
  target: string;
  readonly: boolean;
}

// ============================================================================
// WRAP CONFIG
// ============================================================================

/**
 * Configuration for creating a WRAP execution context
 */
export interface WRAPConfig<TOutput = unknown> {
  context: AgentContext;
  tools?: ToolRegistry;
  boundaries?: Partial<Boundaries>;
  output: OutputSchema<TOutput>;
}

// ============================================================================
// SANDBOX IMPLEMENTATION
// ============================================================================

/**
 * Sandbox - Secure execution environment for WRAP primitives
 *
 * @example
 * ```typescript
 * const sandbox = await Sandbox.create({
 *   type: 'v8',
 *   boundaries: defaultBoundaries,
 *   timeout: 60000
 * });
 *
 * const wrap = await sandbox.createWRAP({
 *   context: myContext,
 *   tools: myTools,
 *   boundaries: myBoundaries,
 *   output: myOutputSchema
 * });
 *
 * const result = await wrap.execute();
 * ```
 */
export class Sandbox extends EventEmitter<SandboxEvents> {
  readonly id: string;
  readonly type: SandboxType;
  readonly boundaries: Boundaries;
  readonly createdAt: Date;

  private _status: SandboxStatus = 'creating';
  private _resources: ResourceUsage;
  private _wraps: Map<string, WRAP> = new Map();
  private _tools: ToolRegistry;
  private _filesystem: VirtualFileSystem | null = null;
  private _network: NetworkAccess | null = null;
  private _logger: Logger;
  private _config: SandboxConfig;
  private _cleanupFns: (() => Promise<void>)[] = [];
  private _checkpoints: Map<string, ExecutionState> = new Map();
  private _isShuttingDown = false;
  private _resourceMonitor: NodeJS.Timeout | null = null;
  private _executionCount = 0;

  private constructor(config: SandboxConfig) {
    super();

    this.id = config.id ?? uuidv4();
    this.type = config.type;
    this.boundaries = config.boundaries;
    this.createdAt = new Date();
    this._config = config;

    this._logger = config.logger ?? createDefaultLogger();
    this._resources = createEmptyResourceUsage();

    this._tools = new ToolRegistryImpl(this._logger);

    if (config.debug) {
      this._setupDebugLogging();
    }
  }

  /**
   * Create a new sandbox instance
   */
  static async create(config: SandboxConfig): Promise<Sandbox> {
    const sandbox = new Sandbox(config);

    try {
      await sandbox._initialize();
      sandbox._setStatus('running');
      return sandbox;
    } catch (error) {
      sandbox._setStatus('error');
      throw new SandboxCreationError(
        `Failed to create sandbox: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Get current sandbox status
   */
  get status(): SandboxStatus {
    return this._status;
  }

  /**
   * Get current resource usage
   */
  get resources(): ResourceUsage {
    return { ...this._resources };
  }

  /**
   * Get the tool registry
   */
  get tools(): ToolRegistry {
    return this._tools;
  }

  /**
   * Get active WRAP instances
   */
  get activeWraps(): WRAP[] {
    return Array.from(this._wraps.values());
  }

  /**
   * Get execution count
   */
  get executionCount(): number {
    return this._executionCount;
  }

  /**
   * Initialize the sandbox
   */
  private async _initialize(): Promise<void> {
    this._logger.info(`Initializing sandbox ${this.id} (type: ${this.type})`);

    // Initialize based on sandbox type
    switch (this.type) {
      case 'v8':
        await this._initializeV8();
        break;
      case 'container':
        await this._initializeContainer();
        break;
      case 'process':
        await this._initializeProcess();
        break;
      case 'wasm':
        await this._initializeWasm();
        break;
      case 'vm':
        await this._initializeVm();
        break;
      case 'firecracker':
        await this._initializeFirecracker();
        break;
      case 'gvisor':
        await this._initializeGvisor();
        break;
      case 'kata':
        await this._initializeKata();
        break;
      case 'none':
        await this._initializeNone();
        break;
      default:
        throw new Error(`Unknown sandbox type: ${this.type}`);
    }

    // Start resource monitoring
    this._startResourceMonitoring();

    this._logger.info(`Sandbox ${this.id} initialized successfully`);
  }

  /**
   * Initialize V8 isolate sandbox
   */
  private async _initializeV8(): Promise<void> {
    // Dynamic import for isolated-vm
    let ivm: typeof import('isolated-vm') | null = null;

    try {
      ivm = await import('isolated-vm');
    } catch {
      this._logger.warn('isolated-vm not available, falling back to process isolation');
      await this._initializeProcess();
      return;
    }

    const isolate = new ivm.Isolate({
      memoryLimit: this.boundaries.memoryLimit / (1024 * 1024), // Convert to MB
      timeout: this.boundaries.timeout
    });

    const context = await isolate.createContext();

    // Store references for cleanup
    this._cleanupFns.push(async () => {
      context.release();
      isolate.dispose();
    });

    // Create V8-specific filesystem and network
    this._filesystem = new V8VirtualFileSystem(context, this.boundaries.filesystem);
    this._network = new V8NetworkAccess(context, this.boundaries.network);
  }

  /**
   * Initialize Docker container sandbox
   */
  private async _initializeContainer(): Promise<void> {
    let Docker: typeof import('dockerode') | null = null;

    try {
      Docker = (await import('dockerode')).default;
    } catch {
      this._logger.warn('dockerode not available, falling back to process isolation');
      await this._initializeProcess();
      return;
    }

    const docker = new Docker();

    // Create container with resource limits
    const container = await docker.createContainer({
      Image: 'wrap-sandbox:latest',
      name: `wrap-${this.id}`,
      HostConfig: {
        Memory: this.boundaries.memoryLimit,
        CpuShares: Math.floor(this.boundaries.cpuLimit * 1024),
        NetworkMode: this.boundaries.network.enabled ? 'bridge' : 'none',
        ReadonlyRootfs: !this.boundaries.filesystem.allowWrite,
        SecurityOpt: ['no-new-privileges'],
        PidsLimit: 100,
      },
      Env: Object.entries(this._config.env ?? {})
        .map(([k, v]) => `${k}=${v}`)
    });

    await container.start();

    this._cleanupFns.push(async () => {
      await container.stop();
      await container.remove();
    });

    this._filesystem = new ContainerVirtualFileSystem(container, this.boundaries.filesystem);
    this._network = new ContainerNetworkAccess(container, this.boundaries.network);
  }

  /**
   * Initialize process-level sandbox
   */
  private async _initializeProcess(): Promise<void> {
    // Process isolation uses Node.js child_process with resource limits
    this._filesystem = new ProcessVirtualFileSystem(this.boundaries.filesystem);
    this._network = new ProcessNetworkAccess(this.boundaries.network);

    // No special cleanup needed for process isolation
  }

  /**
   * Initialize WebAssembly sandbox
   */
  private async _initializeWasm(): Promise<void> {
    this._filesystem = new WasmVirtualFileSystem(this.boundaries.filesystem);
    this._network = new WasmNetworkAccess(this.boundaries.network);
  }

  /**
   * Initialize VM sandbox (e.g., Firecracker)
   */
  private async _initializeVm(): Promise<void> {
    this._filesystem = new VmVirtualFileSystem(this.boundaries.filesystem);
    this._network = new VmNetworkAccess(this.boundaries.network);
  }

  /**
   * Initialize Firecracker microVM
   */
  private async _initializeFirecracker(): Promise<void> {
    this._filesystem = new FirecrackerVirtualFileSystem(this.boundaries.filesystem);
    this._network = new FirecrackerNetworkAccess(this.boundaries.network);
  }

  /**
   * Initialize gVisor sandbox
   */
  private async _initializeGvisor(): Promise<void> {
    this._filesystem = new GvisorVirtualFileSystem(this.boundaries.filesystem);
    this._network = new GvisorNetworkAccess(this.boundaries.network);
  }

  /**
   * Initialize Kata Containers sandbox
   */
  private async _initializeKata(): Promise<void> {
    this._filesystem = new KataVirtualFileSystem(this.boundaries.filesystem);
    this._network = new KataNetworkAccess(this.boundaries.network);
  }

  /**
   * Initialize no isolation (trusted code only)
   */
  private async _initializeNone(): Promise<void> {
    this._logger.warn('Running without sandbox isolation - only use for trusted code!');
    this._filesystem = new DirectVirtualFileSystem(this.boundaries.filesystem);
    this._network = new DirectNetworkAccess(this.boundaries.network);
  }

  /**
   * Create a new WRAP execution context
   */
  async createWRAP<TOutput = unknown>(config: WRAPConfig<TOutput>): Promise<WRAP<TOutput>> {
    this._ensureRunning();

    const wrapId = uuidv4();

    // Merge boundaries (instance overrides defaults)
    const boundaries = {
      ...this.boundaries,
      ...config.boundaries
    };

    // Create execution state
    const state: ExecutionState = {
      status: 'pending',
      step: 'setup',
      progress: 0,
      tokens: { prompt: 0, completion: 0, total: 0, cached: 0, byModel: new Map() },
      costs: { input: 0, output: 0, total: 0, currency: 'USD', byModel: new Map() },
      toolCalls: [],
      errors: [],
      warnings: [],
      timeline: [{
        id: uuidv4(),
        type: 'execution_start',
        timestamp: new Date(),
        data: { wrapId }
      }],
      checkpoints: [],
      iterations: 0
    };

    // Create telemetry data
    const telemetry: TelemetryData = {
      traceId: wrapId,
      spanId: uuidv4(),
      spans: [],
      metrics: [],
      logs: [],
      events: [],
      sampled: true
    };

    // Create WRAP instance
    const wrap: WRAP<TOutput> = {
      id: wrapId,
      context: config.context,
      tools: config.tools ?? this._tools,
      boundaries,
      output: config.output,
      state,
      telemetry
    };

    // Register tools if provided
    if (config.tools) {
      for (const tool of config.tools.list()) {
        if (!this._tools.has(tool.name)) {
          this._tools.register(tool);
        }
      }
    }

    this._wraps.set(wrapId, wrap);
    this._executionCount++;

    this._logger.info(`Created WRAP ${wrapId}`);

    return wrap;
  }

  /**
   * Execute a WRAP primitive
   */
  async execute<TOutput>(wrap: WRAP<TOutput>): Promise<TOutput> {
    this._ensureRunning();

    const startTime = Date.now();
    const timeout = wrap.boundaries.timeout ?? this._config.timeout ?? 60000;

    // Set up timeout
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Execution exceeded timeout of ${timeout}ms`));
      }, timeout);
    });

    try {
      // Update state
      wrap.state.status = 'running';
      wrap.state.step = 'context_loading';
      wrap.state.startedAt = new Date();
      this._addTimelineEvent(wrap, 'state_change', { status: 'running' });

      // Execute with timeout
      const result = await Promise.race([
        this._executeWrap(wrap),
        timeoutPromise
      ]);

      // Clear timeout
      if (timeoutId) clearTimeout(timeoutId);

      // Update state
      wrap.state.status = 'completed';
      wrap.state.step = 'done';
      wrap.state.progress = 100;
      wrap.state.completedAt = new Date();
      wrap.state.duration = Date.now() - startTime;
      this._addTimelineEvent(wrap, 'execution_end', {
        duration: wrap.state.duration,
        status: 'completed'
      });

      this.emit('execution:end', wrap, result);

      return result;
    } catch (error) {
      // Clear timeout
      if (timeoutId) clearTimeout(timeoutId);

      // Record error
      const execError: ExecutionError = {
        id: uuidv4(),
        code: error instanceof Error ? error.constructor.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date(),
        recoverable: this._isRecoverable(error),
        source: 'agent'
      };

      wrap.state.errors.push(execError);
      wrap.state.status = 'failed';
      wrap.state.completedAt = new Date();
      wrap.state.duration = Date.now() - startTime;
      this._addTimelineEvent(wrap, 'error_occurred', { error: execError });

      this.emit('execution:error', wrap, error instanceof Error ? error : new Error(String(error)));

      throw error;
    }
  }

  /**
   * Internal WRAP execution
   */
  private async _executeWrap<TOutput>(wrap: WRAP<TOutput>): Promise<TOutput> {
    // Phase 1: Context Loading
    wrap.state.step = 'context_loading';
    wrap.state.progress = 10;
    await this._loadContext(wrap);

    // Phase 2: Tool Resolution
    wrap.state.step = 'tool_resolution';
    wrap.state.progress = 20;
    await this._resolveTools(wrap);

    // Phase 3: Boundary Check
    wrap.state.step = 'boundary_check';
    wrap.state.progress = 30;
    this._checkBoundaries(wrap);

    // Phase 4: Permission Check
    wrap.state.step = 'permission_check';
    wrap.state.progress = 35;
    this._checkPermissions(wrap);

    // Phase 5: Agent Thinking
    wrap.state.step = 'agent_thinking';
    wrap.state.progress = 40;
    const response = await this._runAgent(wrap);

    // Phase 6: Tool Execution (if needed)
    if (response.toolCalls && response.toolCalls.length > 0) {
      wrap.state.step = 'tool_execution';
      wrap.state.progress = 60;
      await this._executeTools(wrap, response.toolCalls);
    }

    // Phase 7: Output Generation
    wrap.state.step = 'output_generation';
    wrap.state.progress = 80;
    const output = await this._generateOutput(wrap, response);

    // Phase 8: Validation
    wrap.state.step = 'validation_output';
    wrap.state.progress = 90;
    const validated = this._validateOutput(wrap, output);

    // Phase 9: Cleanup
    wrap.state.step = 'cleanup';
    await this._cleanupWrap(wrap);

    return validated;
  }

  /**
   * Load and prepare context
   */
  private async _loadContext<TOutput>(wrap: WRAP<TOutput>): Promise<void> {
    this._logger.debug(`Loading context for WRAP ${wrap.id}`);

    // Validate context
    if (!wrap.context.conversationId) {
      wrap.context.conversationId = uuidv4();
    }

    if (!wrap.context.createdAt) {
      wrap.context.createdAt = new Date();
    }

    wrap.context.updatedAt = new Date();

    // Load any referenced files from context
    for (const message of wrap.context.messages) {
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'file' && part.url && this._filesystem) {
            try {
              const content = await this._filesystem.readFile(part.url);
              part.data = content;
            } catch (error) {
              this._logger.warn(`Failed to load file ${part.url}: ${error}`);
            }
          }
        }
      }
    }

    this._addTimelineEvent(wrap, 'context_loading', {
      messageCount: wrap.context.messages.length
    });
  }

  /**
   * Resolve and validate tools
   */
  private async _resolveTools<TOutput>(wrap: WRAP<TOutput>): Promise<void> {
    this._logger.debug(`Resolving tools for WRAP ${wrap.id}`);

    const tools = wrap.tools.list();

    for (const tool of tools) {
      // Check permissions
      for (const permission of tool.permissions) {
        if (!this._hasPermission(wrap, permission)) {
          this.emit('permission:denied', permission, `Tool ${tool.name}`);
          throw new PermissionDeniedError(
            `Tool ${tool.name} requires permission ${permission}`
          );
        }
      }

      // Validate schema
      try {
        wrap.tools.validate(tool.name, {});
      } catch (error) {
        this._logger.warn(`Invalid schema for tool ${tool.name}: ${error}`);
      }
    }

    this._addTimelineEvent(wrap, 'tool_resolution', {
      toolCount: tools.length,
      tools: tools.map(t => t.name)
    });
  }

  /**
   * Check boundaries before execution
   */
  private _checkBoundaries<TOutput>(wrap: WRAP<TOutput>): void {
    this._logger.debug(`Checking boundaries for WRAP ${wrap.id}`);

    const { boundaries } = wrap;

    // Check memory limit
    if (this._resources.memory.used > boundaries.memoryLimit) {
      this.emit('boundary:violation', 'memory', {
        used: this._resources.memory.used,
        limit: boundaries.memoryLimit
      });
      throw new BoundaryViolationError(
        `Memory usage (${this._resources.memory.used}) exceeds limit (${boundaries.memoryLimit})`
      );
    }

    // Check timeout
    if (boundaries.timeout && boundaries.timeout <= 0) {
      throw new BoundaryViolationError('Timeout must be positive');
    }

    // Check tool call limit
    if (wrap.state.toolCalls.length >= boundaries.maxToolCalls) {
      this.emit('boundary:violation', 'maxToolCalls', {
        current: wrap.state.toolCalls.length,
        limit: boundaries.maxToolCalls
      });
      throw new BoundaryViolationError(
        `Maximum tool calls (${boundaries.maxToolCalls}) exceeded`
      );
    }

    // Check cost limits
    if (boundaries.costLimits.maxTotalCost > 0) {
      if (wrap.state.costs.total > boundaries.costLimits.maxTotalCost) {
        this.emit('boundary:violation', 'cost', {
          used: wrap.state.costs.total,
          limit: boundaries.costLimits.maxTotalCost
        });
        throw new BoundaryViolationError(
          `Cost limit (${boundaries.costLimits.maxTotalCost} ${boundaries.costLimits.currency}) exceeded`
        );
      }
    }
  }

  /**
   * Check permissions before execution
   */
  private _checkPermissions<TOutput>(wrap: WRAP<TOutput>): void {
    this._logger.debug(`Checking permissions for WRAP ${wrap.id}`);

    const { permissions } = wrap.boundaries;

    // Check if any explicitly denied permissions are needed
    for (const tool of wrap.tools.list()) {
      for (const permission of tool.permissions) {
        if (permissions.denied.has(permission)) {
          throw new PermissionDeniedError(
            `Permission ${permission} is explicitly denied for tool ${tool.name}`
          );
        }
      }
    }
  }

  /**
   * Run the agent thinking loop
   */
  private async _runAgent<TOutput>(wrap: WRAP<TOutput>): Promise<Message> {
    this._logger.debug(`Running agent for WRAP ${wrap.id}`);
    this.emit('execution:start', wrap);

    // This would integrate with actual LLM providers
    // For now, return a placeholder response
    const response: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date()
    };

    // Emit thinking stream event
    this._emitStreamEvent(wrap, 'thinking', {
      status: 'processing',
      context: wrap.context.messages.length
    });

    return response;
  }

  /**
   * Execute tool calls
   */
  private async _executeTools<TOutput>(
    wrap: WRAP<TOutput>,
    toolCalls: NonNullable<Message['toolCalls']>
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      const tool = wrap.tools.get(toolCall.name);

      if (!tool) {
        const error: ExecutionError = {
          id: uuidv4(),
          code: 'TOOL_NOT_FOUND',
          message: `Tool ${toolCall.name} not found`,
          timestamp: new Date(),
          recoverable: false,
          source: 'tool'
        };
        wrap.state.errors.push(error);
        continue;
      }

      try {
        // Update tool call status
        toolCall.status = 'running';
        toolCall.startedAt = new Date();

        this.emit('tool:call', toolCall.name, toolCall.input);
        this._emitStreamEvent(wrap, 'tool_start', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.input
        });

        // Create tool context
        const toolContext: import('../types').ToolContext = {
          sandbox: this.getInfo(),
          message: wrap.context.messages[wrap.context.messages.length - 1],
          emit: (event) => this._emitStreamEvent(wrap, 'tool_progress', event.data),
          signal: new AbortController().signal,
          logger: this._logger.child({ tool: tool.name }),
          fs: this._filesystem!,
          network: this._network!,
          toolCallId: toolCall.id,
          timeoutRemaining: wrap.boundaries.timeout
        };

        // Execute with timeout
        const result = await this._withTimeout(
          tool.handler(toolCall.input, toolContext),
          tool.timeout
        );

        // Update tool call
        toolCall.status = 'completed';
        toolCall.output = result;
        toolCall.completedAt = new Date();
        toolCall.duration = toolCall.completedAt.getTime() - toolCall.startedAt.getTime();

        wrap.state.toolCalls.push(toolCall);

        this.emit('tool:result', toolCall.name, result);
        this._emitStreamEvent(wrap, 'tool_end', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: result,
          duration: toolCall.duration
        });

      } catch (error) {
        toolCall.status = 'failed';
        toolCall.error = {
          code: error instanceof Error ? error.constructor.name : 'TOOL_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: this._isRecoverable(error)
        };
        toolCall.completedAt = new Date();
        toolCall.duration = toolCall.completedAt.getTime() - (toolCall.startedAt?.getTime() ?? Date.now());

        const execError: ExecutionError = {
          id: uuidv4(),
          code: 'TOOL_EXECUTION_ERROR',
          message: `Tool ${toolCall.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          details: { toolName: toolCall.name, toolCallId: toolCall.id },
          timestamp: new Date(),
          recoverable: true,
          source: 'tool'
        };

        wrap.state.errors.push(execError);
      }
    }
  }

  /**
   * Generate output from agent response
   */
  private async _generateOutput<TOutput>(
    wrap: WRAP<TOutput>,
    response: Message
  ): Promise<TOutput | unknown> {
    this._logger.debug(`Generating output for WRAP ${wrap.id}`);

    // Extract content from response
    let output: unknown;

    if (typeof response.content === 'string') {
      // Try to parse as JSON
      try {
        output = JSON.parse(response.content);
      } catch {
        output = response.content;
      }
    } else {
      output = response.content;
    }

    // Apply transformation if provided
    if (wrap.output.transform) {
      output = wrap.output.transform(output);
    }

    return output;
  }

  /**
   * Validate output against schema
   */
  private _validateOutput<TOutput>(wrap: WRAP<TOutput>, output: unknown): TOutput {
    this._logger.debug(`Validating output for WRAP ${wrap.id}`);

    if (wrap.output.validation === 'none') {
      return output as TOutput;
    }

    try {
      // Use Zod for validation if available
      const { schema } = wrap.output;
      if ('parse' in schema && typeof schema.parse === 'function') {
        return schema.parse(output) as TOutput;
      }

      // Fallback to JSON Schema validation would go here
      return output as TOutput;
    } catch (error) {
      if (wrap.output.validation === 'strict') {
        throw new OutputValidationError(
          `Output validation failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Lenient mode - return fallback or original
      return (wrap.output.fallback ?? output) as TOutput;
    }
  }

  /**
   * Cleanup after WRAP execution
   */
  private async _cleanupWrap<TOutput>(wrap: WRAP<TOutput>): Promise<void> {
    this._logger.debug(`Cleaning up WRAP ${wrap.id}`);

    // Remove from active wraps
    this._wraps.delete(wrap.id);

    // Emit final stream event
    this._emitStreamEvent(wrap, 'complete', {
      wrapId: wrap.id,
      status: wrap.state.status,
      duration: wrap.state.duration
    });
  }

  /**
   * Create a checkpoint for resumption
   */
  async createCheckpoint(wrap: WRAP): Promise<string> {
    const checkpointId = uuidv4();

    this._checkpoints.set(checkpointId, { ...wrap.state });

    wrap.state.checkpoints.push({
      id: checkpointId,
      timestamp: new Date(),
      state: { ...wrap.state },
      context: { ...wrap.context },
      size: 0,
      compressed: false
    });

    this.emit('checkpoint:created', checkpointId);
    this._addTimelineEvent(wrap, 'checkpoint_created', { checkpointId });

    return checkpointId;
  }

  /**
   * Resume from a checkpoint
   */
  async resumeFromCheckpoint(checkpointId: string): Promise<WRAP | null> {
    const state = this._checkpoints.get(checkpointId);
    if (!state) {
      return null;
    }

    // Would reconstruct WRAP from checkpoint state
    throw new Error('Checkpoint resumption not yet implemented');
  }

  /**
   * Pause sandbox execution
   */
  async pause(): Promise<void> {
    this._ensureRunning();
    this._setStatus('paused');

    // Pause all active WRAPs
    for (const wrap of this._wraps.values()) {
      if (wrap.state.status === 'running') {
        wrap.state.status = 'paused';
        this._addTimelineEvent(wrap, 'state_change', { status: 'paused' });
      }
    }
  }

  /**
   * Resume paused sandbox
   */
  async resume(): Promise<void> {
    if (this._status !== 'paused') {
      throw new Error('Sandbox is not paused');
    }

    this._setStatus('running');

    // Resume all paused WRAPs
    for (const wrap of this._wraps.values()) {
      if (wrap.state.status === 'paused') {
        wrap.state.status = 'running';
        this._addTimelineEvent(wrap, 'state_change', { status: 'running' });
      }
    }
  }

  /**
   * Stop and cleanup sandbox
   */
  async stop(): Promise<void> {
    if (this._isShuttingDown) return;
    this._isShuttingDown = true;

    this._logger.info(`Stopping sandbox ${this.id}`);
    this.emit('cleanup:start');

    // Stop resource monitoring
    if (this._resourceMonitor) {
      clearInterval(this._resourceMonitor);
      this._resourceMonitor = null;
    }

    // Cancel all active WRAPs
    for (const wrap of this._wraps.values()) {
      wrap.state.status = 'cancelled';
      this._addTimelineEvent(wrap, 'state_change', { status: 'cancelled' });
    }
    this._wraps.clear();

    // Run cleanup functions
    for (const cleanup of this._cleanupFns) {
      try {
        await cleanup();
      } catch (error) {
        this._logger.error(`Cleanup error: ${error}`);
      }
    }
    this._cleanupFns = [];

    this._setStatus('stopped');
    this.emit('cleanup:end');

    this._logger.info(`Sandbox ${this.id} stopped`);
  }

  /**
   * Get sandbox info
   */
  getInfo(): SandboxInfo {
    return {
      id: this.id,
      type: this.type,
      status: this._status,
      resources: this._resources,
      createdAt: this.createdAt
    };
  }

  /**
   * Set status and emit event
   */
  private _setStatus(status: SandboxStatus): void {
    const previous = this._status;
    this._status = status;
    this.emit('status:changed', status, previous);
  }

  /**
   * Ensure sandbox is running
   */
  private _ensureRunning(): void {
    if (this._status !== 'running') {
      throw new SandboxNotRunningError(
        `Sandbox is not running (status: ${this._status})`
      );
    }
  }

  /**
   * Check if permission is granted
   */
  private _hasPermission(wrap: WRAP, permission: Permission): boolean {
    const { permissions } = wrap.boundaries;

    // Denied takes precedence
    if (permissions.denied.has(permission)) {
      return false;
    }

    // Check granted
    if (permissions.granted.has(permission)) {
      return true;
    }

    // Check conditions
    const condition = permissions.conditions.get(permission);
    if (condition) {
      return true;
    }

    return permissions.defaultAllow;
  }

  /**
   * Add timeline event
   */
  private _addTimelineEvent<TOutput>(
    wrap: WRAP<TOutput>,
    type: import('../types').TimelineEventType,
    data?: Record<string, unknown>
  ): void {
    wrap.state.timeline.push({
      id: uuidv4(),
      type,
      timestamp: new Date(),
      data
    });
  }

  /**
   * Emit stream event
   */
  private _emitStreamEvent<TOutput>(
    wrap: WRAP<TOutput>,
    type: StreamEventType,
    data: unknown
  ): void {
    const event: StreamEvent = {
      id: uuidv4(),
      type,
      timestamp: new Date(),
      data
    };

    wrap.telemetry.events.push(event as TelemetryEvent);

    if (this._config.onStream) {
      this._config.onStream(event);
    }

    this.emit('stream:event', event);
  }

  /**
   * Check if error is recoverable
   */
  private _isRecoverable(error: unknown): boolean {
    if (error instanceof TimeoutError) return true;
    if (error instanceof RateLimitError) return true;
    if (error instanceof NetworkError) return true;
    return false;
  }

  /**
   * Execute with timeout
   */
  private async _withTimeout<T>(promise: Promise<T> | T, timeout: number): Promise<T> {
    if (!(promise instanceof Promise)) return promise;

    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeout}ms`)), timeout)
      )
    ]);
  }

  /**
   * Start resource monitoring
   */
  private _startResourceMonitoring(): void {
    this._resourceMonitor = setInterval(() => {
      this._updateResourceUsage();
      this._checkResourceLimits();
    }, 1000);
  }

  /**
   * Update resource usage
   */
  private _updateResourceUsage(): void {
    // Memory usage
    const memUsage = process.memoryUsage();
    this._resources.memory.used = memUsage.heapUsed;
    this._resources.memory.total = memUsage.heapTotal;
    this._resources.memory.percentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    this._resources.memory.peak = Math.max(this._resources.memory.peak, memUsage.heapUsed);
    this._resources.memory.rss = memUsage.rss;
    this._resources.memory.heap = {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
      limit: memUsage.rss,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers
    };

    // CPU usage (simplified)
    const cpuUsage = process.cpuUsage();
    this._resources.cpu.userTime = cpuUsage.user;
    this._resources.cpu.systemTime = cpuUsage.system;

    // Process info
    this._resources.processes.count = 1;
  }

  /**
   * Check resource limits
   */
  private _checkResourceLimits(): void {
    const { boundaries } = this;

    // Memory warning
    const memoryUsagePercent = this._resources.memory.used / boundaries.memoryLimit;
    if (memoryUsagePercent > 0.8) {
      this.emit('resource:warning', 'memory', this._resources.memory.used, boundaries.memoryLimit);
    }

    // Memory exceeded
    if (this._resources.memory.used > boundaries.memoryLimit) {
      this.emit('resource:exceeded', 'memory', this._resources.memory.used, boundaries.memoryLimit);
    }
  }

  /**
   * Setup debug logging
   */
  private _setupDebugLogging(): void {
    this.on('status:changed', (status, prev) => {
      this._logger.debug(`Status changed: ${prev} -> ${status}`);
    });

    this.on('tool:call', (name, input) => {
      this._logger.debug(`Tool call: ${name}`, input);
    });

    this.on('tool:result', (name, output) => {
      this._logger.debug(`Tool result: ${name}`, output);
    });
  }
}

// ============================================================================
// TOOL REGISTRY IMPLEMENTATION
// ============================================================================

class ToolRegistryImpl implements ToolRegistry {
  tools: Map<string, Tool> = new Map();
  categories: Map<string, Set<string>> = new Map();

  constructor(private logger: Logger) {}

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool ${tool.name} already registered, overwriting`);
    }

    this.tools.set(tool.name, tool);

    // Add to category
    const category = tool.metadata?.category ?? 'general';
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category)!.add(tool.name);

    this.logger.debug(`Registered tool: ${tool.name} (category: ${category})`);
  }

  unregister(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      this.tools.delete(name);
      const category = tool.metadata?.category ?? 'general';
      this.categories.get(category)?.delete(name);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  byCategory(category: string): Tool[] {
    const names = this.categories.get(category);
    if (!names) return [];
    return Array.from(names)
      .map(name => this.tools.get(name))
      .filter((t): t is Tool => t !== undefined);
  }

  validate(name: string, input: unknown): import('../types').ValidationResult {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        valid: false,
        errors: [{ path: '', message: `Tool ${name} not found` }]
      };
    }

    try {
      const schema = tool.inputSchema;
      if ('parse' in schema && typeof schema.parse === 'function') {
        schema.parse(input);
      }
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: [{
          path: '',
          message: error instanceof Error ? error.message : String(error)
        }]
      };
    }
  }

  async execute(name: string, input: unknown, context: import('../types').ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }

    return tool.handler(input, context);
  }

  getSchemas(): import('../types').ToolSchema[] {
    return this.list().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as import('../types').JSONSchema
      }
    }));
  }
}

// ============================================================================
// VIRTUAL FILESYSTEM PLACEHOLDER IMPLEMENTATIONS
// ============================================================================

class BaseVirtualFileSystem implements VirtualFileSystem {
  constructor(protected boundaries: import('../types').FilesystemBoundaries) {}
  protected _checkPath(_path: string): void {}
  async readFile(_path: string): Promise<Buffer> { throw new Error('Not implemented'); }
  async writeFile(_path: string, _data: Buffer | string): Promise<void> { throw new Error('Not implemented'); }
  async appendFile(_path: string, _data: Buffer | string): Promise<void> { throw new Error('Not implemented'); }
  async deleteFile(_path: string): Promise<void> { throw new Error('Not implemented'); }
  async stat(_path: string): Promise<import('../types').FileStat> { throw new Error('Not implemented'); }
  async exists(_path: string): Promise<boolean> { return false; }
  async mkdir(_path: string, _recursive?: boolean): Promise<void> { throw new Error('Not implemented'); }
  async rmdir(_path: string, _recursive?: boolean): Promise<void> { throw new Error('Not implemented'); }
  async readdir(_path: string): Promise<string[]> { return []; }
  async copy(_src: string, _dst: string): Promise<void> { throw new Error('Not implemented'); }
  async move(_src: string, _dst: string): Promise<void> { throw new Error('Not implemented'); }
  async watch(_path: string, _callback: import('../types').FileWatchCallback): Promise<import('../types').FileWatcher> { throw new Error('Not implemented'); }
  createReadStream(_path: string, _options?: import('../types').StreamOptions): ReadableStream { throw new Error('Not implemented'); }
  createWriteStream(_path: string, _options?: import('../types').StreamOptions): WritableStream { throw new Error('Not implemented'); }
}

class V8VirtualFileSystem extends BaseVirtualFileSystem {
  constructor(private context: any, boundaries: import('../types').FilesystemBoundaries) { super(boundaries); }
}

class ContainerVirtualFileSystem extends BaseVirtualFileSystem {
  constructor(private container: any, boundaries: import('../types').FilesystemBoundaries) { super(boundaries); }
}

class ProcessVirtualFileSystem extends BaseVirtualFileSystem {}
class WasmVirtualFileSystem extends BaseVirtualFileSystem {}
class VmVirtualFileSystem extends BaseVirtualFileSystem {}
class FirecrackerVirtualFileSystem extends BaseVirtualFileSystem {}
class GvisorVirtualFileSystem extends BaseVirtualFileSystem {}
class KataVirtualFileSystem extends BaseVirtualFileSystem {}

class DirectVirtualFileSystem extends BaseVirtualFileSystem {
  async readFile(path: string): Promise<Buffer> {
    const fs = await import('fs/promises');
    return fs.readFile(path);
  }
  async writeFile(path: string, data: Buffer | string): Promise<void> {
    const fs = await import('fs/promises');
    return fs.writeFile(path, data);
  }
  async exists(path: string): Promise<boolean> {
    const fs = await import('fs/promises');
    try { await fs.access(path); return true; } catch { return false; }
  }
}

// ============================================================================
// NETWORK ACCESS PLACEHOLDER IMPLEMENTATIONS
// ============================================================================

class BaseNetworkAccess implements NetworkAccess {
  constructor(protected boundaries: import('../types').NetworkBoundaries) {}
  isAllowed(_url: string): boolean { return false; }
  async fetch(_url: string, _options?: import('../types').FetchOptions): Promise<Response> { throw new Error('Not implemented'); }
  async websocket(_url: string, _options?: import('../types').WebSocketOptions): Promise<WebSocket> { throw new Error('Not implemented'); }
  dns = {
    resolve: async () => [],
    resolve4: async () => [],
    resolve6: async () => [],
    resolveMx: async () => [],
    resolveTxt: async () => [],
    resolveCname: async () => '',
    reverse: async () => [],
    lookup: async () => ({ address: '', family: 4 })
  };
  http = {
    get: async () => { throw new Error('Not implemented'); },
    post: async () => { throw new Error('Not implemented'); },
    put: async () => { throw new Error('Not implemented'); },
    patch: async () => { throw new Error('Not implemented'); },
    delete: async () => { throw new Error('Not implemented'); },
    head: async () => { throw new Error('Not implemented'); },
    options: async () => { throw new Error('Not implemented'); },
    request: async () => { throw new Error('Not implemented'); }
  };
  async resolveHost(_host: string): Promise<string[]> { return []; }
}

class V8NetworkAccess extends BaseNetworkAccess {
  constructor(private context: any, boundaries: import('../types').NetworkBoundaries) { super(boundaries); }
}
class ContainerNetworkAccess extends BaseNetworkAccess {
  constructor(private container: any, boundaries: import('../types').NetworkBoundaries) { super(boundaries); }
}
class ProcessNetworkAccess extends BaseNetworkAccess {}
class WasmNetworkAccess extends BaseNetworkAccess {}
class VmNetworkAccess extends BaseNetworkAccess {}
class FirecrackerNetworkAccess extends BaseNetworkAccess {}
class GvisorNetworkAccess extends BaseNetworkAccess {}
class KataNetworkAccess extends BaseNetworkAccess {}

class DirectNetworkAccess extends BaseNetworkAccess {
  async fetch(url: string, options?: import('../types').FetchOptions): Promise<Response> {
    return globalThis.fetch(url, options as RequestInit);
  }
  isAllowed(url: string): boolean {
    if (!this.boundaries.enabled) return false;
    if (this.boundaries.allowedHosts.includes('*')) return true;
    try {
      const u = new URL(url);
      return this.boundaries.allowedHosts.some(h => u.host === h || u.host.endsWith('.' + h));
    } catch { return false; }
  }
}

// ============================================================================
// ERRORS
// ============================================================================

export class SandboxCreationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SandboxCreationError';
  }
}

export class SandboxNotRunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxNotRunningError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class BoundaryViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundaryViolationError';
  }
}

export class OutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputValidationError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function createEmptyResourceUsage(): ResourceUsage {
  return {
    cpu: { percentage: 0, userTime: 0, systemTime: 0, cores: 1 },
    memory: { used: 0, total: 0, percentage: 0, peak: 0 },
    network: { bytesSent: 0, bytesReceived: 0, requests: 0, connections: 0, errors: 0 },
    filesystem: { used: 0, total: 0, files: 0, directories: 0, reads: 0, writes: 0 },
    processes: { count: 0, threads: 0, openFiles: 0, openSockets: 0 }
  };
}

function createDefaultLogger(): Logger {
  return {
    trace: (msg, ...args) => console.log(`[TRACE] ${msg}`, ...args),
    debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    fatal: (msg, ...args) => console.error(`[FATAL] ${msg}`, ...args),
    child: () => createDefaultLogger(),
    withPrefix: () => createDefaultLogger(),
    withLevel: () => createDefaultLogger(),
    setLevel: () => {},
    getLevel: () => 'debug',
    isLevelEnabled: () => true
  };
}

// ============================================================================
// DEFAULT BOUNDARIES
// ============================================================================

export const defaultBoundaries: Boundaries = {
  timeout: 60000,
  memoryLimit: 512 * 1024 * 1024,
  cpuLimit: 0.5,
  maxToolCalls: 100,
  maxRecursionDepth: 10,
  network: {
    enabled: false,
    allowedHosts: [],
    deniedHosts: [],
    allowedPorts: [],
    deniedPorts: [],
    maxRequestSize: 10 * 1024 * 1024,
    maxResponseSize: 10 * 1024 * 1024,
    requestTimeout: 30000,
    requireHttps: true,
    maxConnections: 10,
    allowWebSocket: false,
    allowHttp2: false
  },
  filesystem: {
    enabled: false,
    root: '/tmp/wrap',
    allowedPaths: [],
    deniedPaths: [],
    allowWrite: false,
    allowDelete: false,
    allowCreate: false,
    maxFileSize: 10 * 1024 * 1024,
    maxStorage: 100 * 1024 * 1024,
    allowedExtensions: [],
    deniedExtensions: [],
    followSymlinks: false,
    allowHiddenFiles: false,
    maxOpenFiles: 100
  },
  environment: {
    enabled: false,
    allowedVars: [],
    deniedVars: [],
    readOnlyVars: []
  },
  permissions: {
    granted: new Set(['fs.read', 'network.http']),
    denied: new Set(),
    conditions: new Map(),
    defaultAllow: false
  },
  rateLimits: [
    { window: 60000, maxRequests: 100, key: 'per_minute', strategy: 'sliding' }
  ],
  costLimits: {
    maxInputCost: 1.0,
    maxOutputCost: 1.0,
    maxTotalCost: 2.0,
    currency: 'USD',
    alertThresholds: [0.5, 0.75, 0.9],
    hardLimit: true
  },
  maxOutputSize: 1024 * 1024,
  maxInputSize: 10 * 1024 * 1024,
  allowedFileTypes: [],
  deniedFileTypes: [],
  strictness: 'normal'
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
  Sandbox,
  SandboxConfig,
  SandboxEvents,
  ResourceAllocation,
  MountConfig,
  WRAPConfig,
  defaultBoundaries
};

/**
 * WRAP JavaScript SDK
 * @module @wrap/js-sdk
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// TYPES
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
export type SandboxStatus = 'creating' | 'running' | 'paused' | 'stopped' | 'error';
export type SandboxType = 'process' | 'container' | 'v8' | 'wasm' | 'vm' | 'none';

export interface Message {
  id: string;
  role: MessageRole;
  content: string | ContentPart[];
  timestamp: Date;
  name?: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface ContentPart {
  type: 'text' | 'image' | 'file';
  text?: string;
  data?: string;
  url?: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
  destructive: boolean;
  permissions: Permission[];
  timeout: number;
  streaming: boolean;
  metadata: ToolMetadata;
  enabled: boolean;
}

export interface ToolContext {
  sandbox: SandboxInfo;
  emit: (event: StreamEvent) => void;
  signal: AbortSignal;
  logger: Logger;
  fs: VirtualFileSystem;
  network: NetworkAccess;
  toolCallId: string;
  timeoutRemaining: number;
}

export interface ToolMetadata {
  version: string;
  category: string;
  tags: string[];
  examples: ToolExample[];
}

export interface ToolExample {
  description: string;
  input: Record<string, unknown>;
  output?: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: unknown;
  error?: ToolError;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
}

export interface ToolError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type Permission = string;

export interface Boundaries {
  timeout: number;
  memoryLimit: number;
  cpuLimit: number;
  maxToolCalls: number;
  network: NetworkBoundaries;
  filesystem: FilesystemBoundaries;
}

export interface NetworkBoundaries {
  enabled: boolean;
  allowedHosts: string[];
  deniedHosts: string[];
}

export interface FilesystemBoundaries {
  enabled: boolean;
  root: string;
  allowWrite: boolean;
  allowDelete: boolean;
}

export interface ExecutionState {
  status: ExecutionStatus;
  step: string;
  progress: number;
  toolCalls: ToolCall[];
  errors: ExecutionError[];
}

export interface ExecutionError {
  code: string;
  message: string;
  timestamp: Date;
  recoverable: boolean;
}

export interface SandboxInfo {
  id: string;
  type: SandboxType;
  status: SandboxStatus;
  resources: ResourceUsage;
  createdAt: Date;
}

export interface ResourceUsage {
  memory: { used: number; total: number; percentage: number };
  cpu: { percentage: number };
}

export interface StreamEvent {
  type: string;
  timestamp: Date;
  data: unknown;
}

export interface VirtualFileSystem {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
}

export interface NetworkAccess {
  fetch(url: string, options?: FetchOptions): Promise<Response>;
  isAllowed(url: string): boolean;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): Logger;
}

// ============================================================================
// WRAP CLIENT
// ============================================================================

export interface WRAPConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  debug?: boolean;
}

export class WRAP extends EventEmitter {
  private config: WRAPConfig;
  private sandboxes: Map<string, Sandbox> = new Map();
  private agents: Map<string, Agent> = new Map();
  private connected = false;
  private sessionId: string;

  private constructor(config: WRAPConfig) {
    super();
    this.config = { timeout: 60000, debug: false, ...config };
    this.sessionId = uuidv4();
  }

  static async create(config?: WRAPConfig): Promise<WRAP> {
    const wrap = new WRAP(config ?? {});
    await wrap.connect();
    return wrap;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    for (const sandbox of this.sandboxes.values()) {
      await sandbox.stop();
    }
    this.sandboxes.clear();
    this.agents.clear();
    this.connected = false;
    this.emit('disconnected');
  }

  async createSandbox(config?: SandboxConfig): Promise<Sandbox> {
    const sandbox = await Sandbox.create(config ?? { type: 'process' });
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  createAgent(config: AgentConfig): Agent {
    const agent = new Agent(config);
    this.agents.set(agent.id, agent);
    return agent;
  }

  async execute(prompt: string, tools?: Tool[]): Promise<string> {
    const agent = this.createAgent({ model: 'gpt-4', tools: tools ?? [] });
    return agent.run(prompt);
  }
}

// ============================================================================
// SANDBOX
// ============================================================================

export interface SandboxConfig {
  type: SandboxType;
  boundaries?: Partial<Boundaries>;
  timeout?: number;
}

export class Sandbox extends EventEmitter {
  readonly id: string;
  readonly type: SandboxType;
  readonly boundaries: Boundaries;
  readonly createdAt: Date;

  private _status: SandboxStatus = 'creating';
  private _resources: ResourceUsage;

  private constructor(config: SandboxConfig) {
    super();
    this.id = uuidv4();
    this.type = config.type;
    this.boundaries = this.defaultBoundaries(config.boundaries);
    this.createdAt = new Date();
    this._resources = {
      memory: { used: 0, total: 0, percentage: 0 },
      cpu: { percentage: 0 }
    };
  }

  static async create(config: SandboxConfig): Promise<Sandbox> {
    const sandbox = new Sandbox(config);
    await sandbox.initialize();
    sandbox._status = 'running';
    return sandbox;
  }

  private async initialize(): Promise<void> {
    this.emit('initialized', { id: this.id, type: this.type });
  }

  get status(): SandboxStatus {
    return this._status;
  }

  get resources(): ResourceUsage {
    return this._resources;
  }

  getInfo(): SandboxInfo {
    return {
      id: this.id,
      type: this.type,
      status: this._status,
      resources: this._resources,
      createdAt: this.createdAt
    };
  }

  async executeCode(code: string, language = 'javascript'): Promise<{ stdout: string; stderr: string; result?: unknown }> {
    this.ensureRunning();
    return { stdout: '', stderr: '', result: undefined };
  }

  async stop(): Promise<void> {
    this._status = 'stopped';
    this.emit('stopped');
  }

  async pause(): Promise<void> {
    this._status = 'paused';
    this.emit('paused');
  }

  async resume(): Promise<void> {
    this._status = 'running';
    this.emit('resumed');
  }

  private ensureRunning(): void {
    if (this._status !== 'running') {
      throw new Error(`Sandbox not running (status: ${this._status})`);
    }
  }

  private defaultBoundaries(overrides?: Partial<Boundaries>): Boundaries {
    return {
      timeout: 60000,
      memoryLimit: 512 * 1024 * 1024,
      cpuLimit: 0.5,
      maxToolCalls: 100,
      network: { enabled: false, allowedHosts: [], deniedHosts: [] },
      filesystem: { enabled: false, root: '/tmp', allowWrite: false, allowDelete: false },
      ...overrides
    };
  }
}

// ============================================================================
// AGENT
// ============================================================================

export interface AgentConfig {
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  boundaries?: Partial<Boundaries>;
  maxIterations?: number;
  temperature?: number;
}

export class Agent extends EventEmitter {
  readonly id: string;
  private config: AgentConfig;
  private state: AgentState;
  private messages: Message[] = [];

  constructor(config: AgentConfig) {
    super();
    this.id = uuidv4();
    this.config = { maxIterations: 10, systemPrompt: 'You are a helpful assistant.', ...config };
    this.state = { status: 'pending', step: 'setup', progress: 0, toolCalls: [], errors: [] };
  }

  async run(prompt: string): Promise<string> {
    this.state.status = 'running';
    this.state.step = 'thinking';
    this.emit('start', { prompt });

    try {
      const result = await this.executeLoop(prompt);
      this.state.status = 'completed';
      this.state.progress = 100;
      this.emit('complete', { result });
      return result;
    } catch (error) {
      this.state.status = 'failed';
      this.state.errors.push({
        code: 'EXECUTION_ERROR',
        message: String(error),
        timestamp: new Date(),
        recoverable: false
      });
      this.emit('error', { error });
      throw error;
    }
  }

  private async executeLoop(prompt: string): Promise<string> {
    this.messages.push({ id: uuidv4(), role: 'user', content: prompt, timestamp: new Date() });
    return 'Execution completed';
  }

  getState(): AgentState {
    return { ...this.state };
  }

  getMessages(): Message[] {
    return [...this.messages];
  }
}

interface AgentState {
  status: ExecutionStatus;
  step: string;
  progress: number;
  toolCalls: ToolCall[];
  errors: ExecutionError[];
}

// ============================================================================
// BUILT-IN TOOLS
// ============================================================================

export const FileTool: Tool = {
  name: 'file',
  description: 'Read and write files',
  inputSchema: { type: 'object', properties: { operation: { type: 'string' }, path: { type: 'string' } } },
  handler: async (input: { operation: string; path: string }) => ({ success: true }),
  destructive: true,
  permissions: ['fs.write'],
  timeout: 30000,
  streaming: false,
  metadata: { version: '1.0.0', category: 'filesystem', tags: ['file'], examples: [] },
  enabled: true
};

export const ShellTool: Tool = {
  name: 'shell',
  description: 'Execute shell commands',
  inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
  handler: async (input: { command: string }) => ({ stdout: '', stderr: '', exitCode: 0 }),
  destructive: true,
  permissions: ['exec.shell'],
  timeout: 60000,
  streaming: true,
  metadata: { version: '1.0.0', category: 'execution', tags: ['shell'], examples: [] },
  enabled: true
};

export const WebTool: Tool = {
  name: 'web',
  description: 'Make HTTP requests',
  inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
  handler: async (input: { url: string }) => ({ status: 200, body: '' }),
  destructive: false,
  permissions: ['network.http'],
  timeout: 30000,
  streaming: false,
  metadata: { version: '1.0.0', category: 'network', tags: ['http'], examples: [] },
  enabled: true
};

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  WRAP,
  Sandbox,
  Agent,
  FileTool,
  ShellTool,
  WebTool
};

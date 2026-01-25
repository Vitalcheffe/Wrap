/**
 * WRAP Agent - AI Agent Execution Engine
 * @module @wrap/core/agent
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import type {
  WRAP, AgentContext, Message, Tool, ToolCall, Boundaries,
  ExecutionState, ExecutionStatus, StreamEvent, ModelProvider,
  ModelConfig, CompletionRequest, CompletionResponse, CompletionChunk,
  TokenUsage, CostUsage, Logger
} from '../types';

// ============================================================================
// AGENT CONFIGURATION
// ============================================================================

export interface AgentConfig {
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  boundaries?: Partial<Boundaries>;
  maxIterations?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  provider?: ModelProvider;
  logger?: Logger;
  onStream?: (event: StreamEvent) => void;
}

// ============================================================================
// AGENT EVENTS
// ============================================================================

export interface AgentEvents {
  'start': (data: { agent: Agent; prompt: string }) => void;
  'thinking': (data: { iteration: number; step: string }) => void;
  'tool:call': (data: { name: string; input: unknown; id: string }) => void;
  'tool:result': (data: { name: string; output: unknown; id: string }) => void;
  'stream:token': (data: { token: string }) => void;
  'complete': (data: { result: string; usage: TokenUsage }) => void;
  'error': (data: { error: Error; recoverable: boolean }) => void;
  'iteration': (data: { iteration: number; maxIterations: number }) => void;
}

// ============================================================================
// AGENT IMPLEMENTATION
// ============================================================================

export class Agent extends EventEmitter<AgentEvents> {
  readonly id: string;
  readonly config: AgentConfig;
  readonly tools: Map<string, Tool> = new Map();
  readonly boundaries: Boundaries;

  private _state: AgentState;
  private _messages: Message[] = [];
  private _provider: ModelProvider | null = null;
  private _logger: Logger;
  private _iterationCount = 0;

  constructor(config: AgentConfig) {
    super();
    this.id = uuidv4();
    this.config = {
      maxIterations: 10,
      temperature: 0.7,
      systemPrompt: 'You are a helpful AI assistant.',
      ...config
    };
    this.boundaries = this._initBoundaries(config.boundaries);
    this._state = this._initState();
    this._logger = config.logger ?? this._createDefaultLogger();

    for (const tool of config.tools ?? []) {
      this.tools.set(tool.name, tool);
    }
  }

  get state(): AgentState {
    return { ...this._state };
  }

  get messages(): Message[] {
    return [...this._messages];
  }

  get iterationCount(): number {
    return this._iterationCount;
  }

  async run(prompt: string, context?: Record<string, unknown>): Promise<string> {
    this._state.status = 'running';
    this._state.step = 'setup';

    const userMessage = this._createMessage('user', prompt);
    this._messages.push(userMessage);

    this.emit('start', { agent: this, prompt });

    try {
      const result = await this._executeLoop(context);
      this._state.status = 'completed';
      this.emit('complete', { result, usage: this._state.tokens });
      return result;
    } catch (error) {
      this._state.status = 'failed';
      this._state.errors.push({
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date()
      });
      this.emit('error', { error: error instanceof Error ? error : new Error(String(error)), recoverable: false });
      throw error;
    }
  }

  private async _executeLoop(context?: Record<string, unknown>): Promise<string> {
    const maxIterations = this.config.maxIterations ?? 10;

    while (this._iterationCount < maxIterations) {
      this._iterationCount++;
      this.emit('iteration', { iteration: this._iterationCount, maxIterations });

      this._state.step = 'thinking';
      this.emit('thinking', { iteration: this._iterationCount, step: 'thinking' });

      const response = await this._callLLM();

      if (response.toolCalls && response.toolCalls.length > 0) {
        this._state.step = 'tool_execution';
        await this._executeTools(response.toolCalls);
        continue;
      }

      return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    }

    return 'Maximum iterations reached without completion';
  }

  private async _callLLM(): Promise<Message> {
    const messages = this._buildMessages();

    const request: CompletionRequest = {
      model: this.config.model,
      messages,
      tools: Array.from(this.tools.values()),
      temperature: this.config.temperature,
      maxTokens: 4096,
      stream: false
    };

    const assistantMessage = this._createMessage('assistant', '');
    this._messages.push(assistantMessage);

    return assistantMessage;
  }

  private async _executeTools(toolCalls: ToolCall[]): Promise<void> {
    for (const toolCall of toolCalls) {
      const tool = this.tools.get(toolCall.name);
      if (!tool) {
        this._state.errors.push({
          code: 'TOOL_NOT_FOUND',
          message: `Tool ${toolCall.name} not found`,
          timestamp: new Date()
        });
        continue;
      }

      try {
        toolCall.status = 'running';
        toolCall.startedAt = new Date();

        this.emit('tool:call', { name: toolCall.name, input: toolCall.input, id: toolCall.id });

        const result = await Promise.resolve(tool.handler(toolCall.input, {} as any));

        toolCall.status = 'completed';
        toolCall.output = result;
        toolCall.completedAt = new Date();

        this.emit('tool:result', { name: toolCall.name, output: result, id: toolCall.id });

        const toolMessage = this._createMessage('tool', JSON.stringify(result));
        toolMessage.toolCallId = toolCall.id;
        this._messages.push(toolMessage);

      } catch (error) {
        toolCall.status = 'failed';
        toolCall.error = {
          code: 'TOOL_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true
        };
        toolCall.completedAt = new Date();
      }
    }
  }

  private _buildMessages(): Message[] {
    const messages: Message[] = [];

    if (this.config.systemPrompt) {
      messages.push(this._createMessage('system', this.config.systemPrompt));
    }

    messages.push(...this._messages);

    return messages;
  }

  private _createMessage(role: Message['role'], content: string): Message {
    return {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date()
    };
  }

  private _initBoundaries(overrides?: Partial<Boundaries>): Boundaries {
    return {
      timeout: 60000,
      memoryLimit: 512 * 1024 * 1024,
      cpuLimit: 0.5,
      maxToolCalls: 100,
      maxRecursionDepth: 10,
      network: { enabled: false, allowedHosts: [], deniedHosts: [], allowedPorts: [], maxRequestSize: 0, maxResponseSize: 0, requestTimeout: 0, requireHttps: true },
      filesystem: { enabled: false, root: '/tmp', allowedPaths: [], deniedPaths: [], allowWrite: false, allowDelete: false, maxFileSize: 0, maxStorage: 0, allowedExtensions: [] },
      environment: { enabled: false, allowedVars: [], deniedVars: [], readOnlyVars: [] },
      permissions: { granted: new Set(), denied: new Set(), conditions: new Map(), defaultAllow: false },
      rateLimits: [],
      costLimits: { maxInputCost: 0, maxOutputCost: 0, maxTotalCost: 0, currency: 'USD', alertThresholds: [] },
      ...overrides
    } as Boundaries;
  }

  private _initState(): AgentState {
    return {
      status: 'pending',
      step: 'setup',
      tokens: { prompt: 0, completion: 0, total: 0, cached: 0, byModel: new Map() },
      costs: { input: 0, output: 0, total: 0, currency: 'USD', byModel: new Map() },
      errors: [],
      warnings: [],
      toolCalls: []
    };
  }

  private _createDefaultLogger(): Logger {
    return {
      trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {},
      child: () => this._createDefaultLogger(),
      withPrefix: () => this._createDefaultLogger(),
      withLevel: () => this._createDefaultLogger(),
      setLevel: () => {}, getLevel: () => 'info', isLevelEnabled: () => true
    };
  }

  addMessage(role: Message['role'], content: string): Message {
    const message = this._createMessage(role, content);
    this._messages.push(message);
    return message;
  }

  clearConversation(): void {
    this._messages = [];
    this._iterationCount = 0;
    this._state = this._initState();
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
  }
}

export interface AgentState {
  status: ExecutionStatus;
  step: string;
  tokens: TokenUsage;
  costs: CostUsage;
  errors: Array<{ code: string; message: string; timestamp: Date }>;
  warnings: Array<{ code: string; message: string; timestamp: Date }>;
  toolCalls: ToolCall[];
}

export default Agent;

/**
 * WRAP NEBULA v2.0 - Agent Runtime
 * Core agent execution engine implementing the WRAP primitive
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
  AgentState,
  AgentStatus,
  AgentBehavior,
  Conversation,
  Message,
  ContentBlock,
  ToolCallContent,
  ToolResultContent,
  ToolDefinition,
  ToolContext,
  ToolResult,
  Boundaries,
  ProviderRequest,
  ProviderResponse,
  ProviderMessage,
  ProviderTool,
  TokenUsage,
  AgentEvent,
  AgentMetrics,
  WRAP,
  WRAPContext,
  DEFAULT_BOUNDARIES,
  DEFAULT_BEHAVIOR,
  WrapError,
  ValidationError,
  TimeoutError,
  TelemetrySpan,
  SpanEvent,
  SpanStatus,
  ProviderToolCall,
} from '../types';
import { createProviderClient, ProviderClient, getProviderFromModel } from './providers';
import { CircuitBreaker } from './circuit-breaker';

// ============================================================================
// Types
// ============================================================================

export interface AgentRuntimeConfig {
  id: string;
  name?: string;
  description?: string;
  model: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
    baseUrl?: string;
    apiKey?: string;
  };
  tools?: string[];
  systemPrompt?: string;
  governorAddress?: string;
  boundaries?: Partial<Boundaries>;
  behavior?: Partial<AgentBehavior>;
}

export interface RunOptions {
  maxIterations?: number;
  timeout?: number;
  tools?: string[];
  stream?: boolean;
  onEvent?: (event: AgentEvent) => void;
}

export interface StepResult {
  type: 'thinking' | 'tool_call' | 'response' | 'error';
  content?: string;
  toolCalls?: ToolCallContent[];
  toolResults?: ToolResultContent[];
  error?: string;
  done: boolean;
}

// ============================================================================
// Agent Runtime Implementation
// ============================================================================

export class AgentRuntime extends EventEmitter {
  private config: AgentRuntimeConfig;
  private state: AgentState;
  private conversation: Conversation;
  private provider: ProviderClient;
  private tools: Map<string, ToolDefinition> = new Map();
  private toolHandlers: Map<string, (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>> = new Map();
  private boundaries: Boundaries;
  private behavior: AgentBehavior;
  private abortController: AbortController | null = null;
  private startTime: number = 0;

  constructor(config: AgentRuntimeConfig) {
    super();
    this.config = config;
    
    // Initialize boundaries
    this.boundaries = {
      ...DEFAULT_BOUNDARIES,
      ...config.boundaries,
    };

    // Initialize behavior
    this.behavior = {
      ...DEFAULT_BEHAVIOR,
      ...config.behavior,
    };

    // Initialize state
    this.state = {
      id: config.id,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      iterations: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      toolCalls: 0,
      errors: [],
    };

    // Initialize conversation
    this.conversation = {
      id: crypto.randomUUID(),
      messages: [],
      metadata: {
        model: config.model.model,
        provider: config.model.provider,
        created: Date.now(),
        lastUpdated: Date.now(),
        totalTokens: 0,
        tags: [],
      },
    };

    // Add system prompt
    if (config.systemPrompt) {
      this.conversation.messages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: [{ type: 'text', text: config.systemPrompt }],
        timestamp: Date.now(),
      });
    }

    // Initialize provider
    this.provider = createProviderClient({
      provider: (config.model.provider || getProviderFromModel(config.model.model)) as 'anthropic' | 'openai' | 'google' | 'ollama',
      apiKey: config.model.apiKey,
      baseUrl: config.model.baseUrl,
      defaultModel: config.model.model,
      timeout: this.behavior.timeout,
      retry: {
        maxAttempts: this.behavior.retryAttempts,
        baseDelay: this.behavior.retryDelay,
        maxDelay: 30000,
        multiplier: 2,
        retryableErrors: ['rate_limit', 'timeout', 'overloaded'],
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeout: 60000,
      },
    });
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    this.state.status = 'initializing';
    this.emit('stateChange', this.state);

    // Health check provider
    try {
      const healthy = await this.provider.health();
      if (!healthy) {
        console.warn(`Provider ${this.config.model.provider} health check failed`);
      }
    } catch (error) {
      console.warn(`Provider health check error:`, error);
    }

    this.state.status = 'idle';
    this.emit('stateChange', this.state);
  }

  /**
   * Run the agent with a task
   */
  async run(task: string, options: RunOptions = {}): Promise<ProviderResponse> {
    // Validate task
    if (!task || typeof task !== 'string') {
      throw new ValidationError('Task must be a non-empty string');
    }

    // Setup run
    this.abortController = new AbortController();
    this.startTime = Date.now();
    const maxIterations = options.maxIterations || this.boundaries.resources.maxIterations;
    const timeout = options.timeout || this.behavior.timeout;

    // Add user message
    this.addMessage('user', task);

    // Update state
    this.state.status = 'running';
    this.state.currentTask = task;
    this.state.iterations = 0;
    this.emit('stateChange', this.state);
    this.emit('event', { type: 'started', timestamp: Date.now(), agentId: this.config.id, data: { task } });

    // Set timeout
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    try {
      // Main execution loop
      let iterations = 0;
      let lastResponse: ProviderResponse | null = null;

      while (iterations < maxIterations) {
        if (this.abortController.signal.aborted) {
          throw new TimeoutError('Agent execution aborted', timeout);
        }

        // Execute one step
        const stepResult = await this.executeStep(options);

        // Handle result
        if (stepResult.done) {
          lastResponse = await this.buildFinalResponse(stepResult);
          break;
        }

        if (stepResult.type === 'error') {
          this.state.errors.push(stepResult.error || 'Unknown error');
          this.emit('event', { type: 'error', timestamp: Date.now(), agentId: this.config.id, data: { error: stepResult.error } });
          
          if (this.behavior.failOnToolError) {
            throw new WrapError(stepResult.error || 'Step failed', 'STEP_ERROR');
          }
        }

        if (stepResult.type === 'tool_call' && stepResult.toolCalls?.length) {
          // Execute tool calls
          const results = await this.executeToolCalls(stepResult.toolCalls);
          
          // Add assistant message with tool calls
          this.addAssistantMessage(stepResult.content || '', stepResult.toolCalls);
          
          // Add tool results
          for (const result of results) {
            this.addToolResultMessage(result);
          }
        }

        iterations++;
        this.state.iterations = iterations;
        this.emit('event', { type: 'metrics', timestamp: Date.now(), agentId: this.config.id, data: { metrics: this.getMetrics() } });
      }

      // Build final response if not done
      if (!lastResponse) {
        lastResponse = await this.buildFinalResponse({
          type: 'response',
          content: 'Maximum iterations reached',
          done: true,
        });
      }

      // Update state
      this.state.status = 'completed';
      this.state.currentTask = undefined;
      this.emit('stateChange', this.state);
      this.emit('event', { type: 'completed', timestamp: Date.now(), agentId: this.config.id, data: { response: lastResponse } });

      return lastResponse;
    } catch (error) {
      this.state.status = 'error';
      this.state.errors.push((error as Error).message);
      this.emit('stateChange', this.state);
      this.emit('event', { type: 'error', timestamp: Date.now(), agentId: this.config.id, data: { error: (error as Error).message } });
      throw error;
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(options: RunOptions): Promise<StepResult> {
    // Build provider request
    const request = this.buildProviderRequest(options);

    // Emit thinking event
    this.emit('event', { type: 'thinking', timestamp: Date.now(), agentId: this.config.id, data: { content: 'Processing...' } });

    try {
      // Call provider
      const response = await this.provider.complete(request);

      // Update token usage
      this.state.tokenUsage.promptTokens += response.usage.promptTokens;
      this.state.tokenUsage.completionTokens += response.usage.completionTokens;
      this.state.tokenUsage.totalTokens += response.usage.totalTokens;

      // Check if done
      if (response.finishReason === 'stop' && !response.toolCalls.length) {
        return {
          type: 'response',
          content: response.content,
          done: true,
        };
      }

      // Has tool calls
      if (response.toolCalls.length > 0) {
        this.state.toolCalls += response.toolCalls.length;
        return {
          type: 'tool_call',
          content: response.content,
          toolCalls: response.toolCalls,
          done: false,
        };
      }

      return {
        type: 'response',
        content: response.content,
        done: true,
      };
    } catch (error) {
      return {
        type: 'error',
        error: (error as Error).message,
        done: false,
      };
    }
  }

  /**
   * Execute tool calls
   */
  private async executeToolCalls(toolCalls: ToolCallContent[]): Promise<ToolResultContent[]> {
    const results: ToolResultContent[] = [];

    for (const toolCall of toolCalls) {
      const startTime = Date.now();
      
      this.emit('event', { 
        type: 'tool_call', 
        timestamp: Date.now(), 
        agentId: this.config.id, 
        data: { toolCall } 
      });

      try {
        const handler = this.toolHandlers.get(toolCall.name);
        if (!handler) {
          results.push({
            toolCallId: toolCall.id,
            content: `Unknown tool: ${toolCall.name}`,
            isError: true,
          });
          continue;
        }

        const context = this.buildToolContext();
        const result = await handler(toolCall.arguments, context);

        results.push({
          toolCallId: toolCall.id,
          content: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
          isError: !result.success,
        });

        this.emit('event', { 
          type: 'tool_result', 
          timestamp: Date.now(), 
          agentId: this.config.id, 
          data: { toolCallId: toolCall.id, result, duration: Date.now() - startTime } 
        });
      } catch (error) {
        results.push({
          toolCallId: toolCall.id,
          content: (error as Error).message,
          isError: true,
        });
      }
    }

    return results;
  }

  /**
   * Build provider request
   */
  private buildProviderRequest(options: RunOptions): ProviderRequest {
    const messages: ProviderMessage[] = this.conversation.messages.map(msg => {
      if (msg.role === 'tool') {
        const toolResult = msg.content[0] as { toolResult: ToolResultContent };
        return {
          role: 'tool' as const,
          content: toolResult.toolResult.content,
          toolCallId: toolResult.toolResult.toolCallId,
        };
      }

      const toolCalls = msg.content
        .filter(block => block.type === 'tool_call')
        .map(block => block.toolCall!)
        .filter(Boolean);

      const textContent = msg.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      return {
        role: msg.role,
        content: textContent,
        toolCalls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        })),
      };
    });

    const tools: ProviderTool[] | undefined = this.tools.size > 0
      ? Array.from(this.tools.values()).map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined;

    return {
      model: this.config.model.model,
      messages,
      tools,
      temperature: this.config.model.temperature,
      maxTokens: this.config.model.maxTokens,
      topP: this.config.model.topP,
      stopSequences: this.config.model.stopSequences,
    };
  }

  /**
   * Build tool context
   */
  private buildToolContext(): ToolContext {
    return {
      agentId: this.config.id,
      conversationId: this.conversation.id,
      vfs: this.createVFSInterface(),
      sandbox: this.createSandboxInterface(),
      secrets: this.createSecretsInterface(),
      telemetry: this.createTelemetryInterface(),
      permissions: [],
      timeout: this.boundaries.resources.timeoutPerStep,
      signal: this.abortController?.signal,
    };
  }

  // Stub interfaces for tools
  private createVFSInterface() {
    return {
      read: async (path: string) => Buffer.from(`File content: ${path}`),
      write: async (path: string, content: Buffer | string) => { },
      delete: async (path: string) => { },
      list: async (path: string) => [],
      exists: async (path: string) => false,
      stat: async (path: string) => ({ size: 0, created: 0, modified: 0, accessed: 0, isDirectory: false, isFile: true, permissions: 'rw' }),
      mkdir: async (path: string) => { },
    };
  }

  private createSandboxInterface() {
    return {
      execute: async (command: string, options?: unknown) => ({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 0,
      }),
      isAllowed: (command: string) => true,
      getPermissions: () => [],
    };
  }

  private createSecretsInterface() {
    const secrets = new Map<string, string>();
    return {
      get: async (key: string) => secrets.get(key) || '',
      set: async (key: string, value: string) => { secrets.set(key, value); },
      delete: async (key: string) => { secrets.delete(key); },
      list: async () => Array.from(secrets.keys()),
    };
  }

  private createTelemetryInterface() {
    return {
      startSpan: (name: string, _options?: unknown): TelemetrySpan => {
        const span: TelemetrySpan = {
          spanId: crypto.randomUUID(),
          traceId: crypto.randomUUID(),
          name,
          startTime: Date.now(),
          endTime: undefined,
          attributes: {} as Record<string, unknown>,
          events: [] as SpanEvent[],
          status: { code: 'ok' as const },
          end: function() { this.endTime = Date.now(); },
          addEvent: function(name: string, attributes?: Record<string, unknown>) { 
            (this.events as SpanEvent[]).push({ name, timestamp: Date.now(), attributes }); 
          },
          setAttribute: function(key: string, value: unknown) { 
            (this.attributes as Record<string, unknown>)[key] = value; 
          },
          setStatus: function(status: SpanStatus) { this.status = status; },
          recordException: function(error: Error) { 
            (this.events as SpanEvent[]).push({ name: 'exception', timestamp: Date.now(), attributes: { error: error.message } }); 
          },
        };
        return span;
      },
      recordMetric: (_name: string, _value: number, _attributes?: unknown) => { },
      log: (_level: unknown, _message: string, _attributes?: unknown) => { },
    };
  }

  /**
   * Add message to conversation
   */
  private addMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void {
    this.conversation.messages.push({
      id: crypto.randomUUID(),
      role,
      content: [{ type: 'text', text: content }],
      timestamp: Date.now(),
    });
    this.conversation.metadata.lastUpdated = Date.now();
  }

  /**
   * Add assistant message with tool calls
   */
  private addAssistantMessage(content: string, toolCalls: ToolCallContent[]): void {
    const messageContent: ContentBlock[] = [];
    
    if (content) {
      messageContent.push({ type: 'text', text: content });
    }
    
    for (const tc of toolCalls) {
      messageContent.push({ type: 'tool_call', toolCall: tc });
    }

    this.conversation.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: messageContent,
      timestamp: Date.now(),
    });
    this.conversation.metadata.lastUpdated = Date.now();
  }

  /**
   * Add tool result message
   */
  private addToolResultMessage(result: ToolResultContent): void {
    this.conversation.messages.push({
      id: crypto.randomUUID(),
      role: 'tool',
      content: [{ type: 'tool_result', toolResult: result }],
      timestamp: Date.now(),
    });
    this.conversation.metadata.lastUpdated = Date.now();
  }

  /**
   * Build final response
   */
  private async buildFinalResponse(stepResult: StepResult): Promise<ProviderResponse> {
    return {
      id: crypto.randomUUID(),
      model: this.config.model.model,
      provider: this.config.model.provider,
      content: stepResult.content || '',
      toolCalls: stepResult.toolCalls || [],
      usage: this.state.tokenUsage,
      finishReason: stepResult.done ? 'stop' : 'max_tokens',
      latency: Date.now() - this.startTime,
    };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Register a tool
   */
  registerTool(
    definition: ToolDefinition,
    handler: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
  ): void {
    this.tools.set(definition.name, definition);
    this.toolHandlers.set(definition.name, handler);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.toolHandlers.delete(name);
  }

  /**
   * Get current state
   */
  getState(): AgentStatus {
    return this.state.status;
  }

  /**
   * Get context
   */
  getContext(): Conversation {
    return this.conversation;
  }

  /**
   * Get metrics
   */
  getMetrics(): AgentMetrics {
    return {
      iterations: this.state.iterations,
      toolCalls: this.state.toolCalls,
      tokens: this.state.tokenUsage,
      latency: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage().heapUsed,
      errors: this.state.errors.length,
    };
  }

  /**
   * Pause execution
   */
  pause(): void {
    if (this.state.status === 'running') {
      this.state.status = 'paused';
      this.emit('stateChange', this.state);
    }
  }

  /**
   * Resume execution
   */
  resume(): void {
    if (this.state.status === 'paused') {
      this.state.status = 'running';
      this.emit('stateChange', this.state);
    }
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.abortController?.abort();
    this.state.status = 'stopped';
    this.emit('stateChange', this.state);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.stop();
    this.tools.clear();
    this.toolHandlers.clear();
    this.removeAllListeners();
  }

  /**
   * Get WRAP representation
   */
  getWRAP(): WRAP {
    // Convert tools Map to RegisteredTool format
    const registeredTools = new Map<string, import('../types').RegisteredTool>();
    for (const [name, def] of this.tools) {
      registeredTools.set(name, {
        definition: def,
        handler: this.toolHandlers.get(name) || (() => Promise.resolve({ success: false, output: null })),
        permissions: [],
      });
    }

    return {
      context: {
        conversation: this.conversation,
        workingMemory: {
          shortTerm: [],
          longTerm: [],
          semantic: [],
          episodic: [],
        },
        userState: {
          preferences: {},
          history: [],
          sessionData: {},
          permissions: [],
        },
        metadata: {},
      },
      tools: {
        tools: registeredTools,
        categories: new Map(),
      },
      boundaries: this.boundaries,
      output: {
        format: 'text',
        includeThinking: this.behavior.thinkingEnabled,
        includeToolCalls: true,
        includeMetrics: true,
        telemetry: {
          enabled: true,
          serviceName: 'wrap-nebula',
          samplingRate: 1,
          exportInterval: 60000,
          attributes: {},
        },
      },
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

export { CircuitBreaker } from './circuit-breaker';
export { createProviderClient, getProviderFromModel } from './providers';
export type { ProviderClient } from './providers';

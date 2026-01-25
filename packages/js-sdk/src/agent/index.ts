/**
 * @fileoverview Agent implementation for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/agent
 * @description This module provides the Agent class with LLM integration,
 * multi-provider support, tool calling, streaming responses, and conversation
 * management.
 */

import EventEmitter from 'eventemitter3';
import type {
  AgentConfig,
  AgentContext,
  AgentResult,
  AgentError,
  AgentMemoryConfig,
  AgentHooks,
  Message,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  ToolDefinition,
  ToolCall,
  ToolResult,
  StreamChunk,
  TokenUsage,
  LLMProvider,
  SandboxConfig,
  Boundaries,
  Permission,
} from '../types';
import {
  Logger,
  generateId,
  withTimeout,
  deferred,
  deepClone,
  deepMerge,
} from '../utils';
import {
  AgentError as AgentErrorClass,
  AgentExecutionError,
  AgentMaxTurnsError,
  LLMProviderError,
  TimeoutError,
  ErrorCodes,
} from '../errors';
import type { LLMProvider as LLMProviderInterface } from './providers';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Agent event map
 */
export interface AgentEventMap {
  started: { agentId: string; conversationId: string };
  message: { message: Message };
  tool_call: { toolCall: ToolCall };
  tool_result: { toolCallId: string; result: ToolResult };
  streaming: { chunk: StreamChunk };
  completed: { result: AgentResult };
  error: { error: Error; context?: AgentContext };
}

/**
 * Agent run options
 */
export interface AgentRunOptions {
  /** Maximum turns */
  maxTurns?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to stream responses */
  stream?: boolean;
  /** System prompt override */
  systemPrompt?: string;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Abort signal */
  abortSignal?: AbortSignal;
}

/**
 * Agent state
 */
export type AgentState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error';

/**
 * Conversation turn
 */
export interface ConversationTurn {
  /** Turn number */
  turn: number;
  /** User message */
  userMessage?: UserMessage;
  /** Assistant message */
  assistantMessage?: AssistantMessage;
  /** Tool calls */
  toolCalls?: ToolCall[];
  /** Tool results */
  toolResults?: ToolResult[];
  /** Token usage */
  tokenUsage?: TokenUsage;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Memory entry
 */
export interface MemoryEntry {
  /** Entry ID */
  id: string;
  /** Entry content */
  content: string;
  /** Importance score (0-1) */
  importance: number;
  /** Created timestamp */
  createdAt: Date;
  /** Last accessed timestamp */
  lastAccessedAt: Date;
  /** Access count */
  accessCount: number;
  /** Embedding vector */
  embedding?: number[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// AGENT CLASS
// ============================================================================

/**
 * Agent class for LLM-powered AI agents
 * @description The Agent class provides a high-level interface for building
 * AI agents that can interact with LLMs, use tools, and manage conversations.
 * 
 * @example
 * ```typescript
 * const agent = new Agent({
 *   provider: 'openai',
 *   model: 'gpt-4',
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: [weatherTool],
 * });
 * 
 * const result = await agent.run('What is the weather in Tokyo?');
 * console.log(result.response);
 * ```
 */
export class Agent extends EventEmitter<AgentEventMap> {
  /** Agent configuration */
  private config: AgentConfig;
  /** Agent ID */
  private agentId: string;
  /** Logger */
  private logger: Logger;
  /** LLM provider */
  private provider: LLMProviderInterface | null = null;
  /** Tools registry */
  private tools: Map<string, ToolDefinition> = new Map();
  /** Tool handlers */
  private toolHandlers: Map<string, (input: unknown) => Promise<unknown>> = new Map();
  /** Conversation history */
  private conversationHistory: Message[] = [];
  /** Conversation turns */
  private turns: ConversationTurn[] = [];
  /** Current turn number */
  private currentTurn = 0;
  /** Agent state */
  private state: AgentState = 'idle';
  /** Memory entries */
  private memories: MemoryEntry[] = [];
  /** Total tokens used */
  private totalTokens = 0;
  /** Current conversation ID */
  private conversationId: string | null = null;
  /** Abort controller */
  private abortController: AbortController | null = null;

  /**
   * Creates a new Agent instance
   * @param config - Agent configuration
   */
  constructor(config: AgentConfig) {
    super();
    
    this.config = this.normalizeConfig(config);
    this.agentId = config.id;
    
    this.logger = new Logger({
      level: 'info',
      prefix: `[Agent:${this.agentId}]`,
    });
    
    // Register tools
    if (config.tools) {
      for (const tool of config.tools) {
        this.registerTool(tool);
      }
    }
    
    this.logger.debug('Agent created');
  }

  /**
   * Normalizes the configuration with defaults
   * @param config - Input configuration
   * @returns Normalized configuration
   */
  private normalizeConfig(config: AgentConfig): AgentConfig {
    return {
      temperature: 0.7,
      maxTokens: 4096,
      maxConversationTurns: 50,
      contextWindowSize: 8192,
      ...config,
    };
  }

  /**
   * Gets the agent ID
   */
  public get id(): string {
    return this.agentId;
  }

  /**
   * Gets the agent state
   */
  public get currentState(): AgentState {
    return this.state;
  }

  /**
   * Gets the current turn number
   */
  public get turnNumber(): number {
    return this.currentTurn;
  }

  /**
   * Gets the total tokens used
   */
  public get totalTokensUsed(): number {
    return this.totalTokens;
  }

  /**
   * Gets the conversation history
   */
  public get history(): Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Gets the conversation turns
   */
  public get conversationTurns(): ConversationTurn[] {
    return [...this.turns];
  }

  /**
   * Gets the tools
   */
  public get availableTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Registers a tool
   * @param tool - Tool definition
   * @param handler - Tool handler
   */
  public registerTool(
    tool: ToolDefinition,
    handler?: (input: unknown) => Promise<unknown>
  ): void {
    this.tools.set(tool.name, tool);
    
    if (handler) {
      this.toolHandlers.set(tool.name, handler);
    }
    
    this.logger.debug(`Tool registered: ${tool.name}`);
  }

  /**
   * Unregisters a tool
   * @param toolName - Tool name
   */
  public unregisterTool(toolName: string): void {
    this.tools.delete(toolName);
    this.toolHandlers.delete(toolName);
    this.logger.debug(`Tool unregistered: ${toolName}`);
  }

  /**
   * Sets the LLM provider
   * @param provider - LLM provider instance
   */
  public setProvider(provider: LLMProviderInterface): void {
    this.provider = provider;
    this.logger.debug('Provider set');
  }

  /**
   * Runs the agent with a message
   * @param message - User message
   * @param options - Run options
   * @returns Agent result
   */
  public async run(
    message: string | UserMessage,
    options: AgentRunOptions = {}
  ): Promise<AgentResult> {
    if (this.state === 'running') {
      throw new AgentErrorClass('Agent is already running');
    }
    
    this.state = 'running';
    this.conversationId = generateId('conversation');
    this.abortController = new AbortController();
    
    const startTime = Date.now();
    const maxTurns = options.maxTurns ?? this.config.maxConversationTurns ?? 50;
    const timeout = options.timeout ?? this.config.maxTokens! * 100;
    
    // Create user message
    const userMessage: UserMessage = typeof message === 'string' 
      ? this.createUserMessage(message)
      : message;
    
    // Add to history
    this.conversationHistory.push(userMessage);
    
    this.logger.info(`Starting agent run: ${this.conversationId}`);
    this.emit('started', {
      agentId: this.agentId,
      conversationId: this.conversationId,
    });
    
    // Run hooks
    await this.runHook('beforeStart', this.createContext());
    
    try {
      // Run with timeout
      const result = await withTimeout(
        async () => this.runLoop(maxTurns, options),
        timeout,
        'Agent run timeout'
      );
      
      const endTime = Date.now();
      
      // Update result
      result.duration = endTime - startTime;
      result.totalTokens = this.totalTokens;
      result.turns = this.currentTurn;
      
      // Run hooks
      await this.runHook('afterComplete', result);
      
      // Emit completed event
      this.emit('completed', { result });
      
      this.state = 'completed';
      
      return result;
    } catch (error) {
      const endTime = Date.now();
      
      const agentError: AgentError = {
        type: error instanceof TimeoutError ? 'timeout' : 'unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        recoverable: error instanceof TimeoutError,
      };
      
      const result: AgentResult = {
        executionId: generateId('exec'),
        agentId: this.agentId,
        response: '',
        success: false,
        error: agentError,
        totalTokens: this.totalTokens,
        duration: endTime - startTime,
        turns: this.currentTurn,
      };
      
      // Run hooks
      await this.runHook('onError', error instanceof Error ? error : new Error(String(error)), this.createContext());
      
      // Emit error event
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: this.createContext(),
      });
      
      this.state = 'error';
      
      throw error;
    }
  }

  /**
   * Main agent run loop
   * @param maxTurns - Maximum turns
   * @param options - Run options
   * @returns Agent result
   */
  private async runLoop(
    maxTurns: number,
    options: AgentRunOptions
  ): Promise<AgentResult> {
    let lastResponse = '';
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    
    while (this.currentTurn < maxTurns) {
      // Check for abort
      if (this.abortController?.signal.aborted) {
        throw new AgentErrorClass('Agent run aborted');
      }
      
      this.currentTurn++;
      
      this.logger.debug(`Turn ${this.currentTurn}`);
      
      // Build messages for LLM
      const messages = this.buildMessages(options.systemPrompt);
      
      // Call LLM
      const response = await this.callLLM(messages, options);
      
      // Track tokens
      if (response.tokenUsage) {
        this.totalTokens += response.tokenUsage.totalTokens;
      }
      
      // Check if we have tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Process tool calls
        const results = await this.processToolCalls(response.toolCalls);
        
        toolCalls.push(...response.toolCalls);
        toolResults.push(...results);
        
        // Add assistant message with tool calls
        const assistantMessage: AssistantMessage = {
          id: generateId('msg'),
          role: 'assistant',
          content: response.content ?? '',
          toolCalls: response.toolCalls,
          status: 'complete',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        this.conversationHistory.push(assistantMessage);
        
        // Add tool results
        for (const result of results) {
          const toolMessage: ToolMessage = {
            id: generateId('msg'),
            role: 'tool',
            toolCallId: result.toolCallId,
            content: typeof result.content === 'string' 
              ? result.content 
              : JSON.stringify(result.content),
            success: result.success,
            error: result.error?.message,
            executionTime: result.executionTime,
            status: 'complete',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          
          this.conversationHistory.push(toolMessage);
        }
        
        // Record turn
        this.turns.push({
          turn: this.currentTurn,
          assistantMessage,
          toolCalls: response.toolCalls,
          toolResults: results,
          tokenUsage: response.tokenUsage,
          timestamp: new Date(),
        });
        
        // Check if we should continue or stop
        if (response.stopReason === 'tool_use' || response.stopReason === 'end_turn') {
          continue;
        }
        
        lastResponse = response.content ?? '';
        break;
      } else {
        // No tool calls, we're done
        lastResponse = response.content ?? '';
        
        // Add assistant message
        const assistantMessage: AssistantMessage = {
          id: generateId('msg'),
          role: 'assistant',
          content: lastResponse,
          status: 'complete',
          createdAt: new Date(),
          updatedAt: new Date(),
          model: this.config.model,
        };
        
        this.conversationHistory.push(assistantMessage);
        
        // Record turn
        this.turns.push({
          turn: this.currentTurn,
          assistantMessage,
          tokenUsage: response.tokenUsage,
          timestamp: new Date(),
        });
        
        break;
      }
    }
    
    if (this.currentTurn >= maxTurns) {
      throw new AgentMaxTurnsError('Maximum turns exceeded', {
        agentId: this.agentId,
        conversationId: this.conversationId!,
        maxTurns,
        currentTurns: this.currentTurn,
      });
    }
    
    return {
      executionId: generateId('exec'),
      agentId: this.agentId,
      response: lastResponse,
      success: true,
      toolCalls,
      toolResults,
      totalTokens: this.totalTokens,
      duration: 0,
      turns: this.currentTurn,
    };
  }

  /**
   * Builds messages for LLM call
   * @param systemPromptOverride - System prompt override
   * @returns Messages array
   */
  private buildMessages(systemPromptOverride?: string): Message[] {
    const messages: Message[] = [];
    
    // Add system message
    const systemPrompt = systemPromptOverride ?? this.config.systemPrompt;
    if (systemPrompt) {
      const systemMessage: SystemMessage = {
        id: generateId('msg'),
        role: 'system',
        content: systemPrompt,
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      messages.push(systemMessage);
    }
    
    // Add conversation history
    messages.push(...this.conversationHistory);
    
    return messages;
  }

  /**
   * Calls the LLM provider
   * @param messages - Messages to send
   * @param options - Run options
   * @returns LLM response
   */
  private async callLLM(
    messages: Message[],
    options: AgentRunOptions
  ): Promise<{
    content?: string;
    toolCalls?: ToolCall[];
    stopReason?: string;
    tokenUsage?: TokenUsage;
  }> {
    if (!this.provider) {
      throw new LLMProviderError('Provider not set', {
        agentId: this.agentId,
        provider: this.config.provider,
      });
    }
    
    // Get tool definitions
    const tools = Array.from(this.tools.values());
    
    try {
      const response = await this.provider.createCompletion({
        messages,
        tools,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        model: this.config.model,
        stream: options.stream,
      });
      
      if (options.stream && response.stream) {
        return this.handleStreamingResponse(response);
      }
      
      return {
        content: response.content,
        toolCalls: response.toolCalls,
        stopReason: response.stopReason,
        tokenUsage: response.tokenUsage,
      };
    } catch (error) {
      throw new LLMProviderError('LLM call failed', {
        agentId: this.agentId,
        provider: this.config.provider,
        model: this.config.model,
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Handles streaming response
   * @param response - Streaming response
   * @returns Aggregated response
   */
  private async handleStreamingResponse(response: {
    stream: AsyncIterable<StreamChunk>;
  }): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    tokenUsage?: TokenUsage;
  }> {
    let content = '';
    const toolCalls: ToolCall[] = [];
    let tokenUsage: TokenUsage | undefined;
    
    for await (const chunk of response.stream) {
      content += chunk.content;
      
      if (chunk.toolCall) {
        // Merge tool call chunks
        const existingCall = toolCalls.find(tc => tc.id === chunk.toolCall?.id);
        if (existingCall && chunk.toolCall?.function?.arguments) {
          existingCall.function.arguments += chunk.toolCall.function.arguments;
        } else if (chunk.toolCall?.id && chunk.toolCall?.function) {
          toolCalls.push({
            id: chunk.toolCall.id,
            type: 'function',
            function: {
              name: chunk.toolCall.function.name ?? '',
              arguments: chunk.toolCall.function.arguments ?? '',
            },
          });
        }
      }
      
      if (chunk.tokenUsage) {
        tokenUsage = chunk.tokenUsage;
      }
      
      // Emit streaming event
      this.emit('streaming', { chunk });
    }
    
    return { content, toolCalls, tokenUsage };
  }

  /**
   * Processes tool calls
   * @param toolCalls - Tool calls to process
   * @returns Tool results
   */
  private async processToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    
    for (const toolCall of toolCalls) {
      const startTime = Date.now();
      const toolName = toolCall.function.name;
      
      this.logger.debug(`Processing tool call: ${toolName}`);
      this.emit('tool_call', { toolCall });
      
      try {
        // Parse arguments
        const args = JSON.parse(toolCall.function.arguments);
        
        // Get tool handler
        const handler = this.toolHandlers.get(toolName);
        
        if (!handler) {
          throw new AgentErrorClass(`Tool handler not found: ${toolName}`);
        }
        
        // Execute tool
        const result = await handler(args);
        
        const endTime = Date.now();
        
        const toolResult: ToolResult = {
          executionId: generateId('exec'),
          toolCallId: toolCall.id,
          toolName,
          success: true,
          content: result,
          executionTime: endTime - startTime,
        };
        
        results.push(toolResult);
        
        this.emit('tool_result', {
          toolCallId: toolCall.id,
          result: toolResult,
        });
      } catch (error) {
        const endTime = Date.now();
        
        const toolResult: ToolResult = {
          executionId: generateId('exec'),
          toolCallId: toolCall.id,
          toolName,
          success: false,
          content: null,
          error: {
            type: 'execution',
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
          executionTime: endTime - startTime,
        };
        
        results.push(toolResult);
        
        this.emit('tool_result', {
          toolCallId: toolCall.id,
          result: toolResult,
        });
      }
    }
    
    return results;
  }

  /**
   * Creates a user message
   * @param content - Message content
   * @returns User message
   */
  private createUserMessage(content: string): UserMessage {
    return {
      id: generateId('msg'),
      role: 'user',
      content,
      status: 'complete',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Creates the agent context
   * @returns Agent context
   */
  private createContext(): AgentContext {
    return {
      agentId: this.agentId,
      conversationId: this.conversationId ?? '',
      turnNumber: this.currentTurn,
      messages: this.conversationHistory,
      tools: this.tools,
    };
  }

  /**
   * Runs a lifecycle hook
   * @param hookName - Hook name
   * @param args - Hook arguments
   */
  private async runHook(
    hookName: keyof AgentHooks,
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

  // =========================================================================
  // PUBLIC METHODS
  // =========================================================================

  /**
   * Aborts the current run
   */
  public abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.state = 'idle';
      this.logger.info('Agent run aborted');
    }
  }

  /**
   * Resets the agent state
   */
  public reset(): void {
    this.conversationHistory = [];
    this.turns = [];
    this.currentTurn = 0;
    this.totalTokens = 0;
    this.conversationId = null;
    this.state = 'idle';
    this.memories = [];
    
    this.logger.info('Agent reset');
  }

  /**
   * Adds a message to the conversation
   * @param message - Message to add
   */
  public addMessage(message: Message): void {
    this.conversationHistory.push(message);
  }

  /**
   * Adds a memory
   * @param content - Memory content
   * @param importance - Importance score
   */
  public addMemory(content: string, importance = 0.5): void {
    const memory: MemoryEntry = {
      id: generateId('memory'),
      content,
      importance,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
    };
    
    this.memories.push(memory);
    
    // Trim memories if over limit
    const maxMemories = this.config.memory?.maxMemories ?? 100;
    if (this.memories.length > maxMemories) {
      this.memories.sort((a, b) => b.importance - a.importance);
      this.memories = this.memories.slice(0, maxMemories);
    }
  }

  /**
   * Gets relevant memories
   * @param query - Query string
   * @param limit - Maximum memories to return
   * @returns Relevant memories
   */
  public getMemories(query: string, limit = 5): MemoryEntry[] {
    // Simple keyword matching for now
    // In production, would use semantic search with embeddings
    const relevant = this.memories
      .filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
    
    // Update access time and count
    for (const memory of relevant) {
      memory.lastAccessedAt = new Date();
      memory.accessCount++;
    }
    
    return relevant;
  }

  /**
   * Sets the system prompt
   * @param prompt - New system prompt
   */
  public setSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
  }

  /**
   * Gets the agent status
   * @returns Status string
   */
  public getStatus(): string {
    return [
      `Agent: ${this.agentId}`,
      `  State: ${this.state}`,
      `  Provider: ${this.config.provider}`,
      `  Model: ${this.config.model}`,
      `  Turn: ${this.currentTurn}`,
      `  Tokens: ${this.totalTokens}`,
      `  Messages: ${this.conversationHistory.length}`,
      `  Tools: ${this.tools.size}`,
      `  Memories: ${this.memories.length}`,
    ].join('\n');
  }

  /**
   * Gets the configuration
   * @returns Agent configuration
   */
  public getConfig(): AgentConfig {
    return { ...this.config };
  }
}

// ============================================================================
// AGENT BUILDER
// ============================================================================

/**
 * Builder for creating agents
 */
export class AgentBuilder {
  private config: Partial<AgentConfig> = {};
  private tools: ToolDefinition[] = [];
  private toolHandlers: Map<string, (input: unknown) => Promise<unknown>> = new Map();

  /**
   * Sets the agent ID
   * @param id - Agent ID
   * @returns Builder
   */
  public withId(id: string): this {
    this.config.id = id;
    return this;
  }

  /**
   * Sets the agent name
   * @param name - Agent name
   * @returns Builder
   */
  public withName(name: string): this {
    this.config.name = name;
    return this;
  }

  /**
   * Sets the provider
   * @param provider - Provider name
   * @returns Builder
   */
  public withProvider(provider: LLMProvider): this {
    this.config.provider = provider;
    return this;
  }

  /**
   * Sets the model
   * @param model - Model name
   * @returns Builder
   */
  public withModel(model: string): this {
    this.config.model = model;
    return this;
  }

  /**
   * Sets the system prompt
   * @param prompt - System prompt
   * @returns Builder
   */
  public withSystemPrompt(prompt: string): this {
    this.config.systemPrompt = prompt;
    return this;
  }

  /**
   * Sets the temperature
   * @param temperature - Temperature value
   * @returns Builder
   */
  public withTemperature(temperature: number): this {
    this.config.temperature = temperature;
    return this;
  }

  /**
   * Sets the max tokens
   * @param maxTokens - Max tokens
   * @returns Builder
   */
  public withMaxTokens(maxTokens: number): this {
    this.config.maxTokens = maxTokens;
    return this;
  }

  /**
   * Adds a tool
   * @param tool - Tool definition
   * @param handler - Tool handler
   * @returns Builder
   */
  public withTool(
    tool: ToolDefinition,
    handler?: (input: unknown) => Promise<unknown>
  ): this {
    this.tools.push(tool);
    if (handler) {
      this.toolHandlers.set(tool.name, handler);
    }
    return this;
  }

  /**
   * Sets the max turns
   * @param maxTurns - Max turns
   * @returns Builder
   */
  public withMaxTurns(maxTurns: number): this {
    this.config.maxConversationTurns = maxTurns;
    return this;
  }

  /**
   * Sets memory configuration
   * @param config - Memory config
   * @returns Builder
   */
  public withMemory(config: AgentMemoryConfig): this {
    this.config.memory = config;
    return this;
  }

  /**
   * Sets sandbox configuration
   * @param config - Sandbox config
   * @returns Builder
   */
  public withSandbox(config: SandboxConfig): this {
    this.config.sandbox = config;
    return this;
  }

  /**
   * Sets boundaries
   * @param boundaries - Boundaries
   * @returns Builder
   */
  public withBoundaries(boundaries: Boundaries): this {
    this.config.boundaries = boundaries;
    return this;
  }

  /**
   * Sets permissions
   * @param permissions - Permissions
   * @returns Builder
   */
  public withPermissions(permissions: Permission[]): this {
    this.config.permissions = permissions;
    return this;
  }

  /**
   * Sets hooks
   * @param hooks - Agent hooks
   * @returns Builder
   */
  public withHooks(hooks: AgentHooks): this {
    this.config.hooks = hooks;
    return this;
  }

  /**
   * Builds the agent
   * @returns Agent instance
   */
  public build(): Agent {
    const config: AgentConfig = {
      id: this.config.id ?? generateId('agent'),
      name: this.config.name ?? 'agent',
      provider: this.config.provider ?? 'openai',
      model: this.config.model ?? 'gpt-4',
      temperature: this.config.temperature ?? 0.7,
      maxTokens: this.config.maxTokens ?? 4096,
      maxConversationTurns: this.config.maxConversationTurns ?? 50,
      tools: this.tools,
      ...this.config,
    };
    
    const agent = new Agent(config);
    
    // Register tool handlers
    for (const [name, handler] of this.toolHandlers) {
      const tool = this.tools.find(t => t.name === name);
      if (tool) {
        agent.registerTool(tool, handler);
      }
    }
    
    return agent;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Agent;

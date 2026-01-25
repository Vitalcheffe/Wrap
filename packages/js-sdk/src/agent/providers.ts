/**
 * @fileoverview LLM Provider implementations for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/agent/providers
 * @description This module provides LLM provider implementations for OpenAI,
 * Anthropic, and local models with streaming response handling.
 */

import type {
  Message,
  ToolDefinition,
  ToolCall,
  TokenUsage,
  LLMProvider as LLMProviderType,
  StreamChunk,
} from '../types';
import { Logger, generateId, retry, RetryPolicies } from '../utils';
import { LLMProviderError, ErrorCodes } from '../errors';

// ============================================================================
// TYPES
// ============================================================================

/**
 * LLM completion request
 */
export interface CompletionRequest {
  /** Messages for completion */
  messages: Message[];
  /** Available tools */
  tools?: ToolDefinition[];
  /** Temperature */
  temperature?: number;
  /** Maximum tokens */
  maxTokens?: number;
  /** Model to use */
  model: string;
  /** Whether to stream */
  stream?: boolean;
  /** Stop sequences */
  stopSequences?: string[];
  /** Top-p sampling */
  topP?: number;
  /** Frequency penalty */
  frequencyPenalty?: number;
  /** Presence penalty */
  presencePenalty?: number;
}

/**
 * LLM completion response
 */
export interface CompletionResponse {
  /** Response content */
  content?: string;
  /** Tool calls */
  toolCalls?: ToolCall[];
  /** Stop reason */
  stopReason?: string;
  /** Token usage */
  tokenUsage?: TokenUsage;
  /** Stream for streaming responses */
  stream?: AsyncIterable<StreamChunk>;
  /** Model used */
  model?: string;
  /** Provider used */
  provider?: string;
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  /** Provider name */
  readonly name: string;
  
  /** Creates a completion */
  createCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  
  /** Counts tokens in messages */
  countTokens(messages: Message[]): Promise<number>;
  
  /** Gets available models */
  getModels(): Promise<string[]>;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** API key */
  apiKey?: string;
  /** Base URL */
  baseUrl?: string;
  /** Organization ID */
  organizationId?: string;
  /** Project ID */
  projectId?: string;
  /** Default model */
  defaultModel?: string;
  /** Request timeout */
  timeout?: number;
  /** Max retries */
  maxRetries?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Custom fetch function */
  fetch?: typeof fetch;
}

/**
 * OpenAI-specific configuration
 */
export interface OpenAIConfig extends ProviderConfig {
  /** Whether to use Azure */
  azure?: boolean;
  /** Azure deployment name */
  azureDeployment?: string;
  /** Azure API version */
  azureApiVersion?: string;
}

/**
 * Anthropic-specific configuration
 */
export interface AnthropicConfig extends ProviderConfig {
  /** API version */
  apiVersion?: string;
}

/**
 * Local provider configuration
 */
export interface LocalProviderConfig extends ProviderConfig {
  /** Model path */
  modelPath?: string;
  /** Number of GPU layers */
  gpuLayers?: number;
  /** Context size */
  contextSize?: number;
  /** Number of threads */
  threads?: number;
}

// ============================================================================
// BASE PROVIDER
// ============================================================================

/**
 * Base provider implementation
 */
export abstract class BaseLLMProvider implements LLMProvider {
  protected config: ProviderConfig;
  protected logger: Logger;
  
  abstract readonly name: string;
  
  constructor(config: ProviderConfig = {}) {
    this.config = {
      timeout: 60000,
      maxRetries: 3,
      ...config,
    };
    
    this.logger = new Logger({
      level: 'info',
      prefix: `[${this.name}Provider]`,
    });
  }
  
  abstract createCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  
  abstract countTokens(messages: Message[]): Promise<number>;
  
  abstract getModels(): Promise<string[]>;
  
  /**
   * Makes an HTTP request
   */
  protected async makeRequest<T>(
    url: string,
    options: RequestInit
  ): Promise<T> {
    const fetchFn = this.config.fetch ?? fetch;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
      ...(options.headers as Record<string, string>),
    };
    
    const response = await retry(
      async () => {
        const res = await fetchFn(url, {
          ...options,
          headers,
        });
        
        if (!res.ok) {
          const error = await res.text().catch(() => 'Unknown error');
          throw new LLMProviderError(`HTTP error: ${res.status}`, {
            provider: this.name,
            statusCode: res.status,
            details: { body: error },
          });
        }
        
        return res;
      },
      {
        ...RetryPolicies.network(),
        maxAttempts: this.config.maxRetries ?? 3,
      }
    );
    
    return response.json();
  }
}

// ============================================================================
// OPENAI PROVIDER
// ============================================================================

/**
 * OpenAI provider implementation
 * @description Provides integration with OpenAI's API including GPT-4, GPT-3.5,
 * and other OpenAI models.
 * 
 * @example
 * ```typescript
 * const provider = new OpenAIProvider({
 *   apiKey: 'sk-...',
 * });
 * 
 * const response = await provider.createCompletion({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 */
export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  
  private baseUrl: string;
  
  constructor(config: OpenAIConfig = {}) {
    super(config);
    
    if (config.azure && config.azureDeployment) {
      this.baseUrl = `${config.baseUrl ?? 'https://api.openai.com/v1'}/deployments/${config.azureDeployment}`;
    } else {
      this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    }
  }
  
  async createCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    
    const body = this.buildRequestBody(request);
    
    const headers: Record<string, string> = {};
    
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    
    if (this.config.organizationId) {
      headers['OpenAI-Organization'] = this.config.organizationId;
    }
    
    if ((this.config as OpenAIConfig).azure) {
      headers['api-key'] = this.config.apiKey ?? '';
    }
    
    if (request.stream) {
      return this.createStreamingCompletion(url, body, headers);
    }
    
    const response = await this.makeRequest<OpenAIResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    });
    
    return this.parseResponse(response);
  }
  
  async countTokens(messages: Message[]): Promise<number> {
    // Approximate token count
    // In production, would use tiktoken
    let count = 0;
    
    for (const message of messages) {
      const content = typeof message.content === 'string' 
        ? message.content 
        : JSON.stringify(message.content);
      
      // Rough approximation: ~4 characters per token
      count += Math.ceil(content.length / 4);
      
      // Add overhead for message structure
      count += 4;
    }
    
    return count;
  }
  
  async getModels(): Promise<string[]> {
    return [
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4-turbo-preview',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k',
    ];
  }
  
  /**
   * Builds the request body
   */
  private buildRequestBody(request: CompletionRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(m => this.formatMessage(m)),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      frequency_penalty: request.frequencyPenalty,
      presence_penalty: request.presencePenalty,
      stop: request.stopSequences,
      stream: request.stream,
    };
    
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => this.formatTool(t));
      body.tool_choice = 'auto';
    }
    
    return body;
  }
  
  /**
   * Formats a message for OpenAI
   */
  private formatMessage(message: Message): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };
    
    if (message.role === 'user' && message.name) {
      formatted.name = message.name;
    }
    
    if (message.role === 'assistant') {
      const assistantMsg = message as { toolCalls?: ToolCall[]; reasoning?: string };
      if (assistantMsg.toolCalls) {
        formatted.tool_calls = assistantMsg.toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        }));
      }
    }
    
    if (message.role === 'tool') {
      const toolMsg = message as { toolCallId: string; success: boolean };
      formatted.tool_call_id = toolMsg.toolCallId;
    }
    
    return formatted;
  }
  
  /**
   * Formats a tool for OpenAI
   */
  private formatTool(tool: ToolDefinition): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }
  
  /**
   * Creates a streaming completion
   */
  private async createStreamingCompletion(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>
  ): Promise<CompletionResponse> {
    const fetchFn = this.config.fetch ?? fetch;
    
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
    
    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new LLMProviderError(`HTTP error: ${response.status}`, {
        provider: this.name,
        statusCode: response.status,
        details: { body: error },
      });
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new LLMProviderError('No response body');
    }
    
    const stream = this.createStreamIterator(reader);
    
    return { stream };
  }
  
  /**
   * Creates an async iterator for streaming
   */
  private async *createStreamIterator(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): AsyncIterable<StreamChunk> {
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              yield {
                id: generateId(),
                content: '',
                isFinal: true,
              };
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const chunk = this.parseStreamChunk(parsed);
              if (chunk) yield chunk;
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  
  /**
   * Parses a stream chunk
   */
  private parseStreamChunk(data: OpenAIStreamChunk): StreamChunk | null {
    const delta = data.choices[0]?.delta;
    if (!delta) return null;
    
    return {
      id: data.id,
      content: delta.content ?? '',
      isFinal: data.choices[0]?.finish_reason !== null,
      toolCall: delta.tool_calls?.[0] ? {
        id: delta.tool_calls[0].id,
        function: delta.tool_calls[0].function,
      } : undefined,
      tokenUsage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }
  
  /**
   * Parses the response
   */
  private parseResponse(response: OpenAIResponse): CompletionResponse {
    const choice = response.choices[0];
    
    return {
      content: choice?.message?.content ?? undefined,
      toolCalls: choice?.message?.tool_calls?.map(tc => ({
        id: tc.id,
        type: tc.type,
        function: tc.function,
      })),
      stopReason: choice?.finish_reason,
      tokenUsage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      model: response.model,
      provider: this.name,
    };
  }
}

/**
 * OpenAI response types
 */
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: {
      role: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// ANTHROPIC PROVIDER
// ============================================================================

/**
 * Anthropic provider implementation
 * @description Provides integration with Anthropic's Claude API.
 * 
 * @example
 * ```typescript
 * const provider = new AnthropicProvider({
 *   apiKey: 'sk-ant-...',
 * });
 * 
 * const response = await provider.createCompletion({
 *   model: 'claude-3-opus-20240229',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 */
export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  
  private baseUrl: string;
  private apiVersion: string;
  
  constructor(config: AnthropicConfig = {}) {
    super(config);
    
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com/v1';
    this.apiVersion = config.apiVersion ?? '2023-06-01';
  }
  
  async createCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/messages`;
    
    const body = this.buildRequestBody(request);
    
    const headers: Record<string, string> = {
      'anthropic-version': this.apiVersion,
    };
    
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }
    
    if (request.stream) {
      return this.createStreamingCompletion(url, body, headers);
    }
    
    const response = await this.makeRequest<AnthropicResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    });
    
    return this.parseResponse(response);
  }
  
  async countTokens(messages: Message[]): Promise<number> {
    // Use Anthropic's token counting API
    let count = 0;
    
    for (const message of messages) {
      const content = typeof message.content === 'string' 
        ? message.content 
        : JSON.stringify(message.content);
      
      // Approximate: ~3.5 characters per token for Claude
      count += Math.ceil(content.length / 3.5);
    }
    
    return count;
  }
  
  async getModels(): Promise<string[]> {
    return [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
      'claude-3-5-sonnet-20240620',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ];
  }
  
  /**
   * Builds the request body
   */
  private buildRequestBody(request: CompletionRequest): Record<string, unknown> {
    const { systemMessage, messages } = this.extractSystemMessage(request.messages);
    
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: messages.map(m => this.formatMessage(m)),
      temperature: request.temperature,
      top_p: request.topP,
      stop_sequences: request.stopSequences,
      stream: request.stream,
    };
    
    if (systemMessage) {
      body.system = systemMessage;
    }
    
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => this.formatTool(t));
    }
    
    return body;
  }
  
  /**
   * Extracts system message from messages
   */
  private extractSystemMessage(messages: Message[]): {
    systemMessage?: string;
    messages: Message[];
  } {
    const filtered = messages.filter(m => m.role !== 'system');
    const systemMsg = messages.find(m => m.role === 'system');
    
    return {
      systemMessage: systemMsg?.content as string | undefined,
      messages: filtered,
    };
  }
  
  /**
   * Formats a message for Anthropic
   */
  private formatMessage(message: Message): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      role: message.role === 'tool' ? 'user' : message.role,
      content: message.content,
    };
    
    if (message.role === 'assistant') {
      const assistantMsg = message as { toolCalls?: ToolCall[] };
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        formatted.content = [
          { type: 'text', text: message.content ?? '' },
          ...assistantMsg.toolCalls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        ];
      }
    }
    
    if (message.role === 'tool') {
      const toolMsg = message as { toolCallId: string };
      formatted.content = [{
        type: 'tool_result',
        tool_use_id: toolMsg.toolCallId,
        content: message.content,
      }];
    }
    
    return formatted;
  }
  
  /**
   * Formats a tool for Anthropic
   */
  private formatTool(tool: ToolDefinition): Record<string, unknown> {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    };
  }
  
  /**
   * Creates a streaming completion
   */
  private async createStreamingCompletion(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>
  ): Promise<CompletionResponse> {
    const fetchFn = this.config.fetch ?? fetch;
    
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
    
    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new LLMProviderError(`HTTP error: ${response.status}`, {
        provider: this.name,
        statusCode: response.status,
        details: { body: error },
      });
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new LLMProviderError('No response body');
    }
    
    const stream = this.createStreamIterator(reader);
    
    return { stream };
  }
  
  /**
   * Creates an async iterator for streaming
   */
  private async *createStreamIterator(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): AsyncIterable<StreamChunk> {
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            try {
              const parsed = JSON.parse(data);
              const chunk = this.parseStreamChunk(parsed);
              if (chunk) yield chunk;
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  
  /**
   * Parses a stream chunk
   */
  private parseStreamChunk(data: AnthropicStreamEvent): StreamChunk | null {
    if (data.type === 'content_block_delta') {
      return {
        id: generateId(),
        content: data.delta?.text ?? '',
        isFinal: false,
      };
    }
    
    if (data.type === 'message_stop') {
      return {
        id: generateId(),
        content: '',
        isFinal: true,
      };
    }
    
    return null;
  }
  
  /**
   * Parses the response
   */
  private parseResponse(response: AnthropicResponse): CompletionResponse {
    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
    
    const toolUseBlocks = response.content.filter(
      block => block.type === 'tool_use'
    );
    
    return {
      content,
      toolCalls: toolUseBlocks.map(block => ({
        id: block.id,
        type: 'function' as const,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      })),
      stopReason: response.stop_reason,
      tokenUsage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
      model: response.model,
      provider: this.name,
    };
  }
}

/**
 * Anthropic response types
 */
interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  stop_reason?: string;
  stop_sequence?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: { text?: string };
  content_block?: { type: string; text?: string };
}

// ============================================================================
// LOCAL PROVIDER
// ============================================================================

/**
 * Local provider for self-hosted models
 * @description Provides integration with locally hosted models.
 */
export class LocalProvider extends BaseLLMProvider {
  readonly name = 'local';
  
  private baseUrl: string;
  
  constructor(config: LocalProviderConfig = {}) {
    super(config);
    
    this.baseUrl = config.baseUrl ?? 'http://localhost:8080';
  }
  
  async createCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    
    const body = this.buildRequestBody(request);
    
    const response = await this.makeRequest<OpenAIResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    
    // Parse as OpenAI-compatible format
    return {
      content: response.choices[0]?.message?.content,
      tokenUsage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      model: response.model,
      provider: this.name,
    };
  }
  
  async countTokens(messages: Message[]): Promise<number> {
    let count = 0;
    
    for (const message of messages) {
      const content = typeof message.content === 'string' 
        ? message.content 
        : JSON.stringify(message.content);
      
      count += Math.ceil(content.length / 4);
    }
    
    return count;
  }
  
  async getModels(): Promise<string[]> {
    try {
      const response = await this.makeRequest<{ data: Array<{ id: string }> }>(
        `${this.baseUrl}/v1/models`,
        { method: 'GET' }
      );
      return response.data.map(m => m.id);
    } catch {
      return ['local-model'];
    }
  }
  
  /**
   * Builds the request body
   */
  private buildRequestBody(request: CompletionRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: request.stream,
    };
  }
}

// ============================================================================
// PROVIDER FACTORY
// ============================================================================

/**
 * Factory for creating LLM providers
 */
export class ProviderFactory {
  /**
   * Creates a provider instance
   * @param provider - Provider name
   * @param config - Provider configuration
   * @returns Provider instance
   */
  public static create(
    provider: LLMProviderType,
    config?: ProviderConfig
  ): LLMProvider {
    switch (provider) {
      case 'openai':
        return new OpenAIProvider(config as OpenAIConfig);
      case 'anthropic':
        return new AnthropicProvider(config as AnthropicConfig);
      case 'local':
        return new LocalProvider(config as LocalProviderConfig);
      default:
        throw new LLMProviderError(`Unknown provider: ${provider}`, {
          provider,
        });
    }
  }
}

export default LLMProvider;

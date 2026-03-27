/**
 * WRAP NEBULA v2.0 - LLM Provider Clients
 * Unified interface for multiple LLM providers
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { CircuitBreaker, createCircuitBreaker } from './circuit-breaker';
import {
  Provider,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderMessage,
  ProviderTool,
  ProviderToolCall,
  TokenUsage,
  FinishReason,
  ProviderError,
  RetryConfig,
  ModelInfo,
  ToolCallContent,
} from '../types';

// ============================================================================
// Types
// ============================================================================

export interface ProviderClient {
  name: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
  stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
  listModels(): Promise<ModelInfo[]>;
  health(): Promise<boolean>;
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'thinking' | 'done' | 'error';
  delta?: string;
  toolCall?: Partial<ProviderToolCall>;
  thinking?: string;
  error?: string;
  usage?: TokenUsage;
}

export interface ProviderClientConfig {
  provider: Provider;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  timeout: number;
  retry: RetryConfig;
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeout: number;
  };
}

// ============================================================================
// Base Provider Client
// ============================================================================

abstract class BaseProviderClient extends EventEmitter implements ProviderClient {
  abstract name: string;
  protected circuitBreaker: CircuitBreaker;
  protected config: ProviderClientConfig;

  constructor(config: ProviderClientConfig) {
    super();
    this.config = config;
    this.circuitBreaker = createCircuitBreaker({
      failureThreshold: config.circuitBreaker.failureThreshold,
      resetTimeout: config.circuitBreaker.resetTimeout,
      onStateChange: (old, newState) => {
        this.emit('circuitStateChange', { old, new: newState });
      },
    });
  }

  abstract complete(request: ProviderRequest): Promise<ProviderResponse>;
  abstract stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
  abstract listModels(): Promise<ModelInfo[]>;

  async health(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  protected async withRetry<T>(fn: () => Promise<T>, attempt: number = 1): Promise<T> {
    try {
      return await this.circuitBreaker.execute(fn);
    } catch (error) {
      if (attempt >= this.config.retry.maxAttempts) {
        throw error;
      }

      const shouldRetry = this.shouldRetry(error as Error);
      if (!shouldRetry) {
        throw error;
      }

      const delay = this.calculateDelay(attempt);
      await this.sleep(delay);

      return this.withRetry(fn, attempt + 1);
    }
  }

  protected shouldRetry(error: Error): boolean {
    const retryableErrors = this.config.retry.retryableErrors;
    
    if (error instanceof ProviderError) {
      return retryableErrors.some(code => 
        error.code === code || error.message.includes(code)
      );
    }

    // Network errors are generally retryable
    const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];
    if (networkErrors.some(code => error.message.includes(code))) {
      return true;
    }

    // Rate limit errors
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return true;
    }

    return false;
  }

  protected calculateDelay(attempt: number): number {
    const { baseDelay, maxDelay, multiplier } = this.config.retry;
    const delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
    // Add jitter
    return delay + Math.random() * delay * 0.1;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected generateId(): string {
    return `${this.name}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  protected parseToolCalls(toolCalls: ProviderToolCall[]): ToolCallContent[] {
    return toolCalls.map(tc => ({
      id: tc.id || this.generateId(),
      name: tc.function.name,
      arguments: typeof tc.function.arguments === 'string' 
        ? JSON.parse(tc.function.arguments) 
        : tc.function.arguments,
    }));
  }

  protected calculateTokenUsage(usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): TokenUsage {
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    };
  }
}

// ============================================================================
// Anthropic Provider
// ============================================================================

export class AnthropicProvider extends BaseProviderClient {
  name = 'anthropic' as const;
  private baseUrl: string;

  constructor(config: ProviderClientConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      
      const body = this.buildRequestBody(request);
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new ProviderError(
          `Anthropic API error: ${response.status} ${error}`,
          'anthropic',
          { status: response.status, body: error }
        );
      }

      const data = await response.json() as Record<string, unknown>;
      return this.parseResponse(data, startTime);
    });
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `API error: ${response.status} ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const event = JSON.parse(data);
            const chunk = this.parseStreamEvent(event);
            if (chunk) yield chunk;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic doesn't have a list models endpoint
    return [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
        pricing: { inputTokens: 3, outputTokens: 15, currency: 'USD' },
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 15, outputTokens: 75, currency: 'USD' },
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 3, outputTokens: 15, currency: 'USD' },
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 0.25, outputTokens: 1.25, currency: 'USD' },
      },
    ];
  }

  private buildRequestBody(request: ProviderRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages: this.convertMessages(request.messages),
    };

    if (request.system) {
      body.system = request.system;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }

    if (request.stopSequences?.length) {
      body.stop_sequences = request.stopSequences;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    return body;
  }

  private convertMessages(messages: ProviderMessage[]): unknown[] {
    return messages.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          }],
        };
      }

      if (msg.toolCalls?.length) {
        return {
          role: 'assistant',
          content: [
            ...(typeof msg.content === 'string' && msg.content 
              ? [{ type: 'text', text: msg.content }] 
              : []),
            ...msg.toolCalls.map(tc => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            })),
          ],
        };
      }

      return {
        role: msg.role,
        content: typeof msg.content === 'string' 
          ? msg.content 
          : this.convertContentBlocks(msg.content),
      };
    });
  }

  private convertContentBlocks(content: ProviderMessage['content']): unknown[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }

    return content.map(block => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      }
      if (block.type === 'image' && block.image) {
        const source = 'url' in block.image 
          ? { type: 'url', url: block.image.url }
          : { type: 'base64', media_type: block.image.mediaType, data: block.image.data };
        return { type: 'image', source };
      }
      return block;
    });
  }

  private parseResponse(data: Record<string, unknown>, startTime: number): ProviderResponse {
    const content: string[] = [];
    const toolCalls: ProviderToolCall[] = [];

    for (const block of (data.content as unknown[]) || []) {
      const blockData = block as Record<string, unknown>;
      if (blockData.type === 'text') {
        content.push(blockData.text as string);
      } else if (blockData.type === 'tool_use') {
        toolCalls.push({
          id: blockData.id as string,
          type: 'function',
          function: {
            name: (blockData.name as string) || '',
            arguments: JSON.stringify(blockData.input),
          },
        });
      } else if (blockData.type === 'thinking') {
        // Include thinking in metadata
      }
    }

    return {
      id: data.id as string || this.generateId(),
      model: data.model as string || '',
      provider: 'anthropic',
      content: content.join('\n'),
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      usage: this.calculateTokenUsage(data.usage as Record<string, number>),
      finishReason: this.mapFinishReason(data.stop_reason as string),
      latency: Date.now() - startTime,
      metadata: { thinking: (data as Record<string, unknown>).thinking as string },
    };
  }

  private parseStreamEvent(event: Record<string, unknown>): StreamChunk | null {
    const type = event.type as string;

    if (type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown>;
      if (delta.type === 'text_delta') {
        return { type: 'content', delta: delta.text as string };
      }
      if (delta.type === 'input_json_delta') {
        return { 
          type: 'tool_call', 
          toolCall: { id: '', function: { name: '', arguments: delta.partial_json as string } },
        };
      }
    }

    if (type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown>;
      if (block?.type === 'tool_use') {
        return {
          type: 'tool_call',
          toolCall: {
            id: event.index as unknown as string,
            function: { name: block.name as string, arguments: '' },
          },
        };
      }
    }

    if (type === 'message_delta') {
      const usage = event.usage as Record<string, number>;
      if (usage) {
        return {
          type: 'done',
          usage: this.calculateTokenUsage(usage),
        };
      }
    }

    if (type === 'message_start') {
      // Initial message data
      return null;
    }

    return null;
  }

  private mapFinishReason(reason: string): FinishReason {
    const map: Record<string, FinishReason> = {
      'end_turn': 'stop',
      'max_tokens': 'max_tokens',
      'stop_sequence': 'stop',
      'tool_use': 'tool_use',
    };
    return map[reason] || 'stop';
  }
}

// ============================================================================
// OpenAI Provider
// ============================================================================

export class OpenAIProvider extends BaseProviderClient {
  name = 'openai' as const;
  private baseUrl: string;

  constructor(config: ProviderClientConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      
      const body = this.buildRequestBody(request);
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey || ''}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new ProviderError(
          `OpenAI API error: ${response.status} ${error}`,
          'openai',
          { status: response.status, body: error }
        );
      }

      const data = await response.json() as Record<string, unknown>;
      return this.parseResponse(data, startTime);
    });
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey || ''}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `API error: ${response.status} ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const event = JSON.parse(data);
            const chunk = this.parseStreamEvent(event);
            if (chunk) yield chunk;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey || ''}`,
      },
    });

    if (!response.ok) {
      return this.getDefaultModels();
    }

    const data = await response.json() as Record<string, unknown>;
    return (data.data as unknown[]).map((model: unknown) => {
      const m = model as Record<string, unknown>;
      return {
        id: m.id as string,
        name: m.id as string,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsVision: (m.id as string).includes('vision'),
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 1, outputTokens: 2, currency: 'USD' },
      };
    });
  }

  private getDefaultModels(): ModelInfo[] {
    return [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 5, outputTokens: 15, currency: 'USD' },
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 10, outputTokens: 30, currency: 'USD' },
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        contextWindow: 16384,
        maxOutputTokens: 4096,
        supportsVision: false,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 0.5, outputTokens: 1.5, currency: 'USD' },
      },
      {
        id: 'o1-preview',
        name: 'O1 Preview',
        contextWindow: 128000,
        maxOutputTokens: 32768,
        supportsVision: false,
        supportsTools: false,
        supportsStreaming: false,
        supportsThinking: true,
        pricing: { inputTokens: 15, outputTokens: 60, currency: 'USD' },
      },
    ];
  }

  private buildRequestBody(request: ProviderRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(m => this.convertMessage(m)),
    };

    if (request.maxTokens) {
      body.max_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }

    if (request.stopSequences?.length) {
      body.stop = request.stopSequences;
    }

    if (request.tools?.length) {
      body.tools = request.tools;
      if (request.toolChoice) {
        body.tool_choice = request.toolChoice;
      }
    }

    return body;
  }

  private convertMessage(msg: ProviderMessage): Record<string, unknown> {
    const result: Record<string, unknown> = { role: msg.role };

    if (msg.role === 'tool' && msg.toolCallId) {
      result.role = 'tool';
      result.tool_call_id = msg.toolCallId;
      result.content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    } else if (msg.toolCalls?.length) {
      result.content = typeof msg.content === 'string' ? msg.content : null;
      result.tool_calls = msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    } else {
      result.content = typeof msg.content === 'string' 
        ? msg.content 
        : msg.content?.map(c => {
            if (c.type === 'text') return { type: 'text', text: c.text };
            if (c.type === 'image' && c.image) {
              return {
                type: 'image_url',
                image_url: 'url' in c.image ? { url: c.image.url } : { url: `data:${c.image.mediaType};base64,${c.image.data}` },
              };
            }
            return c;
          });
    }

    return result;
  }

  private parseResponse(data: Record<string, unknown>, startTime: number): ProviderResponse {
    const choice = (data.choices as unknown[])?.[0] as Record<string, unknown>;
    const message = choice?.message as Record<string, unknown>;

    return {
      id: data.id as string || this.generateId(),
      model: data.model as string || '',
      provider: 'openai',
      content: message?.content as string || '',
      toolCalls: this.parseToolCalls((message?.tool_calls as ProviderToolCall[]) || []),
      usage: this.calculateTokenUsage(data.usage as Record<string, number>),
      finishReason: this.mapFinishReason(choice?.finish_reason as string),
      latency: Date.now() - startTime,
    };
  }

  private parseStreamEvent(event: Record<string, unknown>): StreamChunk | null {
    const choice = (event.choices as unknown[])?.[0] as Record<string, unknown>;
    if (!choice) return null;

    const delta = choice.delta as Record<string, unknown>;
    if (delta?.content) {
      return { type: 'content', delta: delta.content as string };
    }

    if (delta?.tool_calls) {
      const tc = (delta.tool_calls as unknown[])[0] as Record<string, unknown>;
      return {
        type: 'tool_call',
        toolCall: {
          id: tc?.id as string,
          function: tc?.function as { name: string; arguments: string },
        },
      };
    }

    if (choice.finish_reason) {
      return { type: 'done' };
    }

    return null;
  }

  private mapFinishReason(reason: string): FinishReason {
    const map: Record<string, FinishReason> = {
      'stop': 'stop',
      'length': 'max_tokens',
      'tool_calls': 'tool_use',
      'content_filter': 'content_filter',
    };
    return map[reason] || 'stop';
  }
}

// ============================================================================
// Google Gemini Provider
// ============================================================================

export class GoogleProvider extends BaseProviderClient {
  name = 'google' as const;
  private baseUrl: string;

  constructor(config: ProviderClientConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com';
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      
      const body = this.buildRequestBody(request);
      const url = `${this.baseUrl}/v1beta/models/${request.model}:generateContent?key=${this.config.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new ProviderError(
          `Google API error: ${response.status} ${error}`,
          'google',
          { status: response.status, body: error }
        );
      }

      const data = await response.json() as Record<string, unknown>;
      return this.parseResponse(data, startTime);
    });
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(request);
    const url = `${this.baseUrl}/v1beta/models/${request.model}:streamGenerateContent?key=${this.config.apiKey}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `API error: ${response.status} ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            const chunk = this.parseStreamEvent(event);
            if (chunk) yield chunk;
          } catch {
            // Skip malformed JSON
          }
        }
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(
      `${this.baseUrl}/v1beta/models?key=${this.config.apiKey}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return this.getDefaultModels();
    }

    const data = await response.json() as Record<string, unknown>;
    const models = (data.models as unknown[]) || [];
    return models
      .filter((m: unknown) => ((m as Record<string, unknown>).name as string)?.includes('gemini'))
      .map((model: unknown) => {
        const m = model as Record<string, unknown>;
        return {
          id: (m.name as string).replace('models/', ''),
          name: m.displayName as string,
          contextWindow: 1000000,
          maxOutputTokens: 8192,
          supportsVision: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsThinking: false,
          pricing: { inputTokens: 0.5, outputTokens: 1.5, currency: 'USD' },
        };
      });
  }

  private getDefaultModels(): ModelInfo[] {
    return [
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 3.5, outputTokens: 10.5, currency: 'USD' },
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 0.075, outputTokens: 0.3, currency: 'USD' },
      },
    ];
  }

  private buildRequestBody(request: ProviderRequest): Record<string, unknown> {
    const contents: unknown[] = [];
    let systemInstruction: string | undefined;

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction = typeof msg.content === 'string' ? msg.content : undefined;
        continue;
      }

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: this.convertContent(msg.content),
      });
    }

    const body: Record<string, unknown> = { contents };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.topP !== undefined) generationConfig.topP = request.topP;
    if (request.stopSequences?.length) generationConfig.stopSequences = request.stopSequences;

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    return body;
  }

  private convertContent(content: ProviderMessage['content']): unknown[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    return content.map(block => {
      if (block.type === 'text') {
        return { text: block.text };
      }
      if (block.type === 'image' && block.image) {
        if ('data' in block.image) {
          return {
            inlineData: {
              mimeType: block.image.mediaType,
              data: block.image.data,
            },
          };
        }
        // URL images need to be fetched first
        return { text: `[Image: ${block.image.url}]` };
      }
      return block;
    });
  }

  private parseResponse(data: Record<string, unknown>, startTime: number): ProviderResponse {
    const candidate = (data.candidates as unknown[])?.[0] as Record<string, unknown>;
    const content = candidate?.content as Record<string, unknown>;
    const parts = (content?.parts as unknown[]) || [];

    let textContent = '';
    const toolCalls: ProviderToolCall[] = [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.text) {
        textContent += p.text;
      }
      if (p.functionCall) {
        const fc = p.functionCall as Record<string, unknown>;
        toolCalls.push({
          id: this.generateId(),
          type: 'function',
          function: {
            name: fc.name as string,
            arguments: JSON.stringify(fc.args),
          },
        });
      }
    }

    return {
      id: this.generateId(),
      model: data.model as string || '',
      provider: 'google',
      content: textContent,
      toolCalls: this.parseToolCalls(toolCalls),
      usage: this.calculateTokenUsage(data.usageMetadata as Record<string, number>),
      finishReason: this.mapFinishReason(candidate?.finishReason as string),
      latency: Date.now() - startTime,
    };
  }

  private parseStreamEvent(event: Record<string, unknown>): StreamChunk | null {
    const candidate = (event.candidates as unknown[])?.[0] as Record<string, unknown>;
    if (!candidate) return null;

    const content = candidate.content as Record<string, unknown>;
    const parts = (content?.parts as unknown[]) || [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.text) {
        return { type: 'content', delta: p.text as string };
      }
      if (p.functionCall) {
        const fc = p.functionCall as Record<string, unknown>;
        return {
          type: 'tool_call',
          toolCall: {
            id: this.generateId(),
            function: {
              name: fc.name as string,
              arguments: JSON.stringify(fc.args),
            },
          },
        };
      }
    }

    return null;
  }

  private mapFinishReason(reason: string): FinishReason {
    const map: Record<string, FinishReason> = {
      'STOP': 'stop',
      'MAX_TOKENS': 'max_tokens',
      'SAFETY': 'content_filter',
      'RECITATION': 'content_filter',
    };
    return map[reason] || 'stop';
  }
}

// ============================================================================
// Ollama Provider (Local Models)
// ============================================================================

export class OllamaProvider extends BaseProviderClient {
  name = 'ollama' as const;
  private baseUrl: string;

  constructor(config: ProviderClientConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      
      const body = this.buildRequestBody(request);
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new ProviderError(
          `Ollama API error: ${response.status} ${error}`,
          'ollama',
          { status: response.status, body: error }
        );
      }

      const data = await response.json() as Record<string, unknown>;
      return this.parseResponse(data, startTime);
    });
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `API error: ${response.status} ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const line = decoder.decode(value, { stream: true });
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);
          const chunk = this.parseStreamEvent(event);
          if (chunk) yield chunk;
        } catch {
          // Skip malformed JSON
        }
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as Record<string, unknown>;
    return (data.models as unknown[] || []).map((model: unknown) => {
      const m = model as Record<string, unknown>;
      return {
        id: m.name as string,
        name: m.name as string,
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsVision: false,
        supportsTools: false,
        supportsStreaming: true,
        supportsThinking: false,
        pricing: { inputTokens: 0, outputTokens: 0, currency: 'USD' },
      };
    });
  }

  private buildRequestBody(request: ProviderRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };

    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.maxTokens) options.num_predict = request.maxTokens;
    if (request.topP !== undefined) options.top_p = request.topP;

    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    return body;
  }

  private parseResponse(data: Record<string, unknown>, startTime: number): ProviderResponse {
    const message = data.message as Record<string, unknown>;

    return {
      id: this.generateId(),
      model: data.model as string || '',
      provider: 'ollama',
      content: message?.content as string || '',
      toolCalls: [],
      usage: {
        promptTokens: (data.prompt_eval_count as number) || 0,
        completionTokens: (data.eval_count as number) || 0,
        totalTokens: ((data.prompt_eval_count as number) || 0) + ((data.eval_count as number) || 0),
      },
      finishReason: 'stop',
      latency: Date.now() - startTime,
    };
  }

  private parseStreamEvent(event: Record<string, unknown>): StreamChunk | null {
    const message = event.message as Record<string, unknown>;
    if (message?.content) {
      return { type: 'content', delta: message.content as string };
    }

    if (event.done) {
      return { type: 'done' };
    }

    return null;
  }
}

// ============================================================================
// Provider Factory
// ============================================================================

export function createProviderClient(config: ProviderClientConfig): ProviderClient {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'google':
      return new GoogleProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new ProviderError(`Unknown provider: ${config.provider}`, config.provider);
  }
}

export function getProviderFromModel(model: string): Provider {
  if (model.includes('claude')) return 'anthropic';
  if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'openai';
  if (model.includes('gemini')) return 'google';
  if (model.includes('llama') || model.includes('mistral') || model.includes('codellama')) return 'ollama';
  return 'anthropic';
}

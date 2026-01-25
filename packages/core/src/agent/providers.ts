/**
 * @fileoverview LLM Provider Implementations
 * @description OpenAI, Anthropic, and custom provider support
 * @module @wrap-nebula/core/agent/providers
 * @version 1.0.0
 * @author WRAP Nebula Team
 * @license MIT
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  LLMProvider,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Message,
  ContentPart,
  Tool,
  UsageStats,
  ModelParameters,
} from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Provider interface for LLM implementations.
 */
export interface IProvider {
  /**
   * Get the provider name.
   */
  getName(): LLMProvider;

  /**
   * Complete a chat conversation.
   */
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * Stream a chat completion.
   */
  stream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResponse>;

  /**
   * Count tokens in a message.
   */
  countTokens(message: Message): number;

  /**
   * Check if provider is available.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get available models.
   */
  getModels(): string[];
}

/**
 * OpenAI client interface (lazy loaded).
 */
interface OpenAIClient {
  chat: {
    completions: {
      create: (params: OpenAIChatParams) => Promise<OpenAICompletion>;
    };
  };
}

/**
 * OpenAI chat parameters.
 */
interface OpenAIChatParams {
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  response_format?: { type: string };
}

/**
 * OpenAI completion response.
 */
interface OpenAICompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Anthropic client interface (lazy loaded).
 */
interface AnthropicClient {
  messages: {
    create: (params: AnthropicMessageParams) => Promise<AnthropicMessage>;
    stream: (params: AnthropicMessageParams) => AsyncIterable<AnthropicStreamEvent>;
  };
}

/**
 * Anthropic message parameters.
 */
interface AnthropicMessageParams {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; source?: { type: string; data: string; media_type: string } }>;
  }>;
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  stream?: boolean;
  stop_sequences?: string[];
  metadata?: { user_id?: string };
}

/**
 * Anthropic message response.
 */
interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic stream event.
 */
interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: AnthropicMessage;
  content_block?: { type: string; text?: string; id?: string; name?: string };
}

// ============================================================================
// Base Provider
// ============================================================================

/**
 * Base provider with common functionality.
 */
abstract class BaseProvider implements IProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract getName(): LLMProvider;
  abstract complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  abstract stream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResponse>;
  abstract getModels(): string[];

  /**
   * Count tokens in a message (approximation).
   */
  countTokens(message: Message): number {
    let count = 0;

    if (typeof message.content === 'string') {
      count += this.approximateTokens(message.content);
    } else {
      for (const part of message.content) {
        if (part.type === 'text') {
          count += this.approximateTokens(part.text);
        } else if (part.type === 'image') {
          count += 85; // Default for low detail
        } else if (part.type === 'code') {
          count += this.approximateTokens(part.code);
        } else if (part.type === 'tool_use') {
          count += this.approximateTokens(JSON.stringify(part.input)) + 10;
        }
      }
    }

    // Add overhead for role and formatting
    count += 4;
    if (message.name) {
      count += this.approximateTokens(message.name) + 2;
    }

    return count;
  }

  /**
   * Approximate token count for text.
   */
  protected approximateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if provider is available.
   */
  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  /**
   * Build usage stats from provider response.
   */
  protected buildUsageStats(input: number, output: number): UsageStats {
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
    };
  }

  /**
   * Merge parameters with defaults.
   */
  protected mergeParams(params?: ModelParameters): ModelParameters {
    return {
      ...this.config.defaultParams,
      ...params,
    };
  }
}

// ============================================================================
// OpenAI Provider
// ============================================================================

/**
 * OpenAI provider implementation.
 */
export class OpenAIProvider extends BaseProvider {
  private client: OpenAIClient | null = null;
  private models: string[] = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o1-preview',
  ];

  getName(): LLMProvider {
    return 'openai';
  }

  /**
   * Get the OpenAI client.
   */
  private async getClient(): Promise<OpenAIClient> {
    if (!this.client) {
      const OpenAI = (await import('openai')).default;
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        organization: this.config.organizationId,
        timeout: this.config.timeout ?? 60000,
        maxRetries: this.config.maxRetries ?? 3,
        defaultHeaders: this.config.headers,
      });
    }
    return this.client;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const params = this.mergeParams(request.params);
    const startTime = Date.now();

    const response = await client.chat.completions.create({
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      tools: this.convertTools(request.tools),
      tool_choice: request.toolChoice as 'auto' | 'none' | 'required' | undefined,
      stop: params.stopSequences,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      logit_bias: params.logitBias,
      user: request.user,
      response_format: params.responseFormat ? { type: params.responseFormat.type } : undefined,
    });

    const latency = Date.now() - startTime;
    const choice = response.choices[0]!;

    return {
      id: response.id,
      model: response.model,
      message: {
        id: uuidv4(),
        role: 'assistant',
        content: this.convertContent(choice.message),
        timestamp: Date.now(),
        status: 'complete',
        tokenCount: response.usage?.completion_tokens,
        finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls',
        provider: 'openai',
      },
      usage: this.buildUsageStats(
        response.usage?.prompt_tokens ?? 0,
        response.usage?.completion_tokens ?? 0
      ),
      finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls',
      provider: 'openai',
      latency,
      raw: response,
    };
  }

  async stream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const params = this.mergeParams(request.params);
    const startTime = Date.now();

    const stream = await client.chat.completions.create({
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      tools: this.convertTools(request.tools),
      tool_choice: request.toolChoice as 'auto' | 'none' | 'required' | undefined,
      stop: params.stopSequences,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      user: request.user,
      stream: true,
    });

    let fullContent = '';
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason: string = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream as AsyncIterable<{ choices: Array<{ delta: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }> }>) {
      const delta = chunk.choices[0]?.delta;
      
      if (delta?.content) {
        fullContent += delta.content;
        onChunk({
          id: uuidv4(),
          model: request.model,
          delta: { content: delta.content },
          index: 0,
        });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (existing) {
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            if (tc.function?.name) existing.name = tc.function.name;
          } else {
            toolCalls.set(tc.index, {
              id: tc.id ?? uuidv4(),
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            });
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    const latency = Date.now() - startTime;
    outputTokens = this.approximateTokens(fullContent);

    // Build final response
    const content: ContentPart[] = [];
    if (fullContent) {
      content.push({
        id: uuidv4(),
        type: 'text',
        text: fullContent,
        timestamp: Date.now(),
      });
    }

    for (const [index, tc] of toolCalls) {
      content.push({
        id: tc.id,
        type: 'tool_use',
        toolId: tc.id,
        toolName: tc.name,
        input: JSON.parse(tc.arguments || '{}'),
        timestamp: Date.now(),
      });
    }

    return {
      id: uuidv4(),
      model: request.model,
      message: {
        id: uuidv4(),
        role: 'assistant',
        content: content.length > 0 ? content : fullContent,
        timestamp: Date.now(),
        status: 'complete',
        tokenCount: outputTokens,
        finishReason: finishReason as 'stop' | 'length' | 'tool_calls',
        provider: 'openai',
      },
      usage: this.buildUsageStats(inputTokens, outputTokens),
      finishReason: finishReason as 'stop' | 'length' | 'tool_calls',
      provider: 'openai',
      latency,
    };
  }

  getModels(): string[] {
    return [...this.models];
  }

  /**
   * Convert messages to OpenAI format.
   */
  private convertMessages(messages: Message[]): OpenAIChatParams['messages'] {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        };
      }

      // Convert content parts
      const content = msg.content.map(part => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        if (part.type === 'image') {
          return {
            type: 'image_url',
            image_url: { url: part.source.url ?? `data:${part.source.mediaType};base64,${part.source.data}` },
          };
        }
        if (part.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: part.id,
            name: part.toolName,
            input: part.input,
          };
        }
        if (part.type === 'tool_result') {
          return {
            type: 'tool_result',
            tool_call_id: part.toolUseId,
            content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
          };
        }
        return { type: 'text', text: '' };
      });

      return {
        role: msg.role,
        content,
        ...(msg.name && { name: msg.name }),
      };
    });
  }

  /**
   * Convert tools to OpenAI format.
   */
  private convertTools(tools?: Tool[]): OpenAIChatParams['tools'] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Convert OpenAI response content to our format.
   */
  private convertContent(message: { content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }): string | ContentPart[] {
    const parts: ContentPart[] = [];

    if (message.content) {
      parts.push({
        id: uuidv4(),
        type: 'text',
        text: message.content,
        timestamp: Date.now(),
      });
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        parts.push({
          id: tc.id,
          type: 'tool_use',
          toolId: tc.id,
          toolName: tc.function.name,
          input: JSON.parse(tc.function.arguments),
          timestamp: Date.now(),
        });
      }
    }

    return parts.length > 0 ? parts : '';
  }
}

// ============================================================================
// Anthropic Provider
// ============================================================================

/**
 * Anthropic provider implementation.
 */
export class AnthropicProvider extends BaseProvider {
  private client: AnthropicClient | null = null;
  private models: string[] = [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ];

  getName(): LLMProvider {
    return 'anthropic';
  }

  /**
   * Get the Anthropic client.
   */
  private async getClient(): Promise<AnthropicClient> {
    if (!this.client) {
      const anthropic = await import('@anthropic-ai/sdk');
      this.client = new anthropic.default({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        timeout: this.config.timeout ?? 60000,
        maxRetries: this.config.maxRetries ?? 3,
      });
    }
    return this.client;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const params = this.mergeParams(request.params);
    const startTime = Date.now();

    const { system, messages } = this.extractSystemPrompt(request.messages);

    const response = await client.messages.create({
      model: request.model,
      messages,
      system,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
      top_p: params.topP,
      top_k: params.topK,
      tools: this.convertTools(request.tools),
      stop_sequences: params.stopSequences,
      metadata: request.user ? { user_id: request.user } : undefined,
    });

    const latency = Date.now() - startTime;

    return {
      id: response.id,
      model: response.model,
      message: {
        id: uuidv4(),
        role: 'assistant',
        content: this.convertContent(response.content),
        timestamp: Date.now(),
        status: 'complete',
        tokenCount: response.usage.output_tokens,
        finishReason: this.convertFinishReason(response.stop_reason),
        provider: 'anthropic',
      },
      usage: this.buildUsageStats(
        response.usage.input_tokens,
        response.usage.output_tokens
      ),
      finishReason: this.convertFinishReason(response.stop_reason),
      provider: 'anthropic',
      latency,
      raw: response,
    };
  }

  async stream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const params = this.mergeParams(request.params);
    const startTime = Date.now();

    const { system, messages } = this.extractSystemPrompt(request.messages);

    const stream = client.messages.stream({
      model: request.model,
      messages,
      system,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
      top_p: params.topP,
      top_k: params.topK,
      tools: this.convertTools(request.tools),
      stop_sequences: params.stopSequences,
    });

    let fullContent = '';
    let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;
    const contentBlocks: Array<{ type: string; id?: string; name?: string; text?: string; input?: unknown }> = [];

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          fullContent += event.delta.text;
          onChunk({
            id: uuidv4(),
            model: request.model,
            delta: { content: event.delta.text },
            index: event.index ?? 0,
          });
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block) {
          contentBlocks.push(event.content_block);
        }
      } else if (event.type === 'message_delta') {
        if (event.delta?.stop_reason) {
          finishReason = this.convertFinishReason(event.delta.stop_reason);
        }
      } else if (event.type === 'message_start') {
        if (event.message) {
          inputTokens = event.message.usage?.input_tokens ?? 0;
        }
      } else if (event.type === 'message_stop') {
        // Final message
      }
    }

    const finalMessage = await stream.finalMessage();
    const latency = Date.now() - startTime;

    return {
      id: finalMessage.id,
      model: finalMessage.model,
      message: {
        id: uuidv4(),
        role: 'assistant',
        content: this.convertContent(finalMessage.content),
        timestamp: Date.now(),
        status: 'complete',
        tokenCount: finalMessage.usage.output_tokens,
        finishReason: this.convertFinishReason(finalMessage.stop_reason),
        provider: 'anthropic',
      },
      usage: this.buildUsageStats(
        finalMessage.usage.input_tokens,
        finalMessage.usage.output_tokens
      ),
      finishReason,
      provider: 'anthropic',
      latency,
    };
  }

  getModels(): string[] {
    return [...this.models];
  }

  /**
   * Extract system prompt from messages.
   */
  private extractSystemPrompt(messages: Message[]): {
    system?: string;
    messages: AnthropicMessageParams['messages'];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const system = systemMessages
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n');

    const anthropicMessages: AnthropicMessageParams['messages'] = [];

    for (const msg of otherMessages) {
      const content = this.convertMessageContent(msg);
      anthropicMessages.push({
        role: msg.role as 'user' | 'assistant',
        content,
      });
    }

    return {
      system: system || undefined,
      messages: anthropicMessages,
    };
  }

  /**
   * Convert message content to Anthropic format.
   */
  private convertMessageContent(message: Message): string | AnthropicMessageParams['messages'][0]['content'] {
    if (typeof message.content === 'string') {
      return message.content;
    }

    return message.content.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }
      if (part.type === 'image') {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.source.mediaType ?? 'image/jpeg',
            data: part.source.data ?? '',
          },
        };
      }
      if (part.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: part.id,
          name: part.toolName,
          input: part.input,
        };
      }
      if (part.type === 'tool_result') {
        return {
          type: 'tool_result',
          tool_use_id: part.toolUseId,
          content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
        };
      }
      return { type: 'text', text: '' };
    });
  }

  /**
   * Convert tools to Anthropic format.
   */
  private convertTools(tools?: Tool[]): AnthropicMessageParams['tools'] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  /**
   * Convert Anthropic content to our format.
   */
  private convertContent(content: AnthropicMessage['content']): string | ContentPart[] {
    const parts: ContentPart[] = [];

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push({
          id: uuidv4(),
          type: 'text',
          text: block.text,
          timestamp: Date.now(),
        });
      } else if (block.type === 'tool_use' && block.name && block.input) {
        parts.push({
          id: block.id ?? uuidv4(),
          type: 'tool_use',
          toolId: block.id ?? uuidv4(),
          toolName: block.name,
          input: block.input,
          timestamp: Date.now(),
        });
      }
    }

    return parts.length > 0 ? parts : '';
  }

  /**
   * Convert Anthropic stop reason to our format.
   */
  private convertFinishReason(reason: string | null): 'stop' | 'length' | 'tool_calls' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}

// ============================================================================
// Local/Custom Provider
// ============================================================================

/**
 * Local or custom provider implementation.
 */
export class LocalProvider extends BaseProvider {
  private models: string[] = ['local-model'];

  getName(): LLMProvider {
    return 'local';
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.config.baseUrl) {
      throw new Error('Local provider requires a baseUrl');
    }

    const params = this.mergeParams(request.params);
    const startTime = Date.now();

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content,
        })),
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local provider error: ${response.statusText}`);
    }

    const data = await response.json() as OpenAICompletion;
    const latency = Date.now() - startTime;
    const choice = data.choices[0]!;

    return {
      id: data.id,
      model: data.model,
      message: {
        id: uuidv4(),
        role: 'assistant',
        content: choice.message.content ?? '',
        timestamp: Date.now(),
        status: 'complete',
        tokenCount: data.usage?.completion_tokens,
        finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls',
        provider: 'local',
      },
      usage: this.buildUsageStats(
        data.usage?.prompt_tokens ?? 0,
        data.usage?.completion_tokens ?? 0
      ),
      finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls',
      provider: 'local',
      latency,
    };
  }

  async stream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResponse> {
    if (!this.config.baseUrl) {
      throw new Error('Local provider requires a baseUrl');
    }

    const params = this.mergeParams(request.params);
    const startTime = Date.now();

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content,
        })),
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local provider error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as { choices: Array<{ delta: { content?: string }; finish_reason?: string }> };
            const delta = parsed.choices[0]?.delta;

            if (delta?.content) {
              fullContent += delta.content;
              onChunk({
                id: uuidv4(),
                model: request.model,
                delta: { content: delta.content },
                index: 0,
              });
            }

            if (parsed.choices[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason as 'stop' | 'length' | 'tool_calls';
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const latency = Date.now() - startTime;

    return {
      id: uuidv4(),
      model: request.model,
      message: {
        id: uuidv4(),
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
        status: 'complete',
        tokenCount: this.approximateTokens(fullContent),
        finishReason,
        provider: 'local',
      },
      usage: this.buildUsageStats(0, this.approximateTokens(fullContent)),
      finishReason,
      provider: 'local',
      latency,
    };
  }

  getModels(): string[] {
    return [...this.models];
  }

  setModels(models: string[]): void {
    this.models = [...models];
  }
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Create a provider instance.
 */
export function createProvider(config: ProviderConfig): IProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'local':
    case 'custom':
      return new LocalProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Get available providers.
 */
export function getAvailableProviders(): LLMProvider[] {
  return ['openai', 'anthropic', 'local', 'custom'];
}

// ============================================================================
// Exports
// ============================================================================

export {
  BaseProvider,
  OpenAIProvider,
  AnthropicProvider,
  LocalProvider,
  createProvider,
  getAvailableProviders,
};

export type {
  IProvider,
  OpenAIClient,
  OpenAIChatParams,
  OpenAICompletion,
  AnthropicClient,
  AnthropicMessageParams,
  AnthropicMessage,
  AnthropicStreamEvent,
};

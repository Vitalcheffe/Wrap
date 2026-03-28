/**
 * WRAP NEBULA v2.0 - Ghost Client
 * Main thin HTTP client implementation
 */

import { EventEmitter } from 'events';
import { InputSanitizer } from './sanitizer';
import {
  GhostError,
  ValidationError,
  SecurityError,
  ConnectionError,
  TimeoutError,
  QuotaError,
  SandboxError,
} from './errors';
import type { ProviderResponse, TokenUsage, ToolCall, AgentEvent } from './types';

// ============================================================================
// Types
// ============================================================================

export interface GhostConfig {
  endpoint?: string;
  model?: string;
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  sanitizeInput?: boolean;
  rateLimitRps?: number;
}

export interface RunOptions {
  maxIterations?: number;
  timeout?: number;
  tools?: string[];
  additionalContext?: Record<string, unknown>;
  stream?: boolean;
  onEvent?: (event: AgentEvent) => void;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

// ============================================================================
// Rate Limiter
// ============================================================================

class TokenBucketRateLimiter {
  private tokens: number;
  private lastUpdate: number;
  private lock: Promise<void> = Promise.resolve();

  constructor(private rate: number) {
    this.tokens = rate;
    this.lastUpdate = Date.now();
  }

  async acquire(): Promise<void> {
    const previousLock = this.lock;
    this.lock = (async () => {
      await previousLock;
      const now = Date.now();
      const elapsed = (now - this.lastUpdate) / 1000;
      this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate);
      this.lastUpdate = now;

      if (this.tokens < 1) {
        const waitTime = ((1 - this.tokens) / this.rate) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.tokens = 0;
      } else {
        this.tokens -= 1;
      }
    })();
    await this.lock;
  }
}

// ============================================================================
// Ghost Client
// ============================================================================

export class Ghost extends EventEmitter {
  private config: Required<GhostConfig>;
  private sanitizer: InputSanitizer | null;
  private rateLimiter: TokenBucketRateLimiter;
  private abortController: AbortController | null = null;

  constructor(config: GhostConfig = {}) {
    super();
    this.config = {
      endpoint: config.endpoint || 'http://localhost:3777',
      model: config.model || 'claude-sonnet-4-20250514',
      apiKey: config.apiKey || '',
      timeout: config.timeout || 300000,
      maxRetries: config.maxRetries || 3,
      sanitizeInput: config.sanitizeInput ?? true,
      rateLimitRps: config.rateLimitRps || 10,
    };

    this.sanitizer = this.config.sanitizeInput ? new InputSanitizer() : null;
    this.rateLimiter = new TokenBucketRateLimiter(this.config.rateLimitRps);
  }

  /**
   * Execute a task
   */
  async run(task: string, options: RunOptions = {}): Promise<ProviderResponse> {
    // Sanitize input
    if (this.sanitizer) {
      const result = this.sanitizer.sanitize(task);
      if (result.rejected) {
        throw new SecurityError(`Input rejected: ${result.reason}`);
      }
      task = result.sanitized || task;
    }

    // Rate limit
    await this.rateLimiter.acquire();

    // Build request
    const payload = this.buildRequest(task, options);

    // Execute with retry
    const response = await this.executeWithRetry('/v1/execute', payload);

    return this.parseResponse(response);
  }

  /**
   * Execute task with streaming
   */
  async *stream(task: string, options: RunOptions = {}): AsyncGenerator<AgentEvent> {
    // Sanitize input
    if (this.sanitizer) {
      const result = this.sanitizer.sanitize(task);
      if (result.rejected) {
        throw new SecurityError(`Input rejected: ${result.reason}`);
      }
      task = result.sanitized || task;
    }

    // Rate limit
    await this.rateLimiter.acquire();

    // Build request
    const payload = this.buildRequest(task, options);
    payload.stream = true;

    // Execute with streaming
    const response = await this.makeRequest('/v1/stream', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!response.body) {
      throw new ConnectionError('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
          return;
        }

        try {
          const event = JSON.parse(data);
          yield this.parseEvent(event);
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  /**
   * Health check
   */
  async health(): Promise<Record<string, unknown>> {
    const response = await this.makeRequest('/health');
    return response.json();
  }

  /**
   * List agents
   */
  async listAgents(): Promise<Array<{ id: string; status: string }>> {
    const response = await this.makeRequest('/v1/agents');
    const data = await response.json();
    return data.agents || [];
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<Record<string, unknown>> {
    const response = await this.makeRequest(`/v1/agents/${agentId}`);
    return response.json();
  }

  /**
   * Delete agent
   */
  async deleteAgent(agentId: string): Promise<boolean> {
    const response = await this.makeRequest(`/v1/agents/${agentId}`, { method: 'DELETE' });
    const data = await response.json();
    return data.deleted === true;
  }

  /**
   * List tools
   */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const response = await this.makeRequest('/v1/tools');
    const data = await response.json();
    return data.tools || [];
  }

  /**
   * Close the client
   */
  close(): void {
    this.removeAllListeners();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private buildRequest(task: string, options: RunOptions): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      task,
      model: this.config.model,
    };

    if (options.maxIterations) {
      payload.maxIterations = options.maxIterations;
    }
    if (options.timeout) {
      payload.timeout = options.timeout;
    }
    if (options.tools) {
      payload.tools = options.tools;
    }
    if (options.additionalContext) {
      payload.context = options.additionalContext;
    }

    return payload;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private async makeRequest(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = `${this.config.endpoint}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: { ...this.getHeaders(), ...options.headers },
        body: options.body as BodyInit,
        signal: controller.signal,
      });

      this.checkResponse(response);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async executeWithRetry(
    path: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await this.makeRequest(path, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return response.json();
      } catch (error) {
        lastError = error as Error;

        if (error instanceof ValidationError || error instanceof SecurityError) {
          throw error;
        }

        // Exponential backoff
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(Math.pow(2, attempt) * 1000, 10000))
        );
      }
    }

    throw lastError || new GhostError('Max retries exceeded');
  }

  private checkResponse(response: Response): void {
    if (response.ok) return;

    const status = response.status;

    if (status === 400) {
      throw new ValidationError(`Validation error: ${response.statusText}`);
    }
    if (status === 401 || status === 403) {
      throw new SecurityError(`Security error: ${response.statusText}`);
    }
    if (status === 429) {
      throw new QuotaError(`Rate limited: ${response.statusText}`);
    }
    if (status === 503) {
      throw new ConnectionError(`Service unavailable: ${response.statusText}`);
    }

    throw new GhostError(`HTTP ${status}: ${response.statusText}`);
  }

  private parseResponse(data: Record<string, unknown>): ProviderResponse {
    return {
      id: (data.id as string) || '',
      model: (data.model as string) || this.config.model,
      provider: (data.provider as string) || '',
      content: (data.content as string) || '',
      toolCalls: (data.toolCalls as ToolCall[]) || [],
      usage: (data.usage as TokenUsage) || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: (data.finishReason as string) || 'stop',
      latency: (data.latency as number) || 0,
    };
  }

  private parseEvent(data: Record<string, unknown>): AgentEvent {
    return {
      type: (data.type as string) || 'unknown',
      timestamp: (data.timestamp as number) || Date.now(),
      agentId: (data.agentId as string) || '',
      data: (data.data as Record<string, unknown>) || {},
    };
  }
}

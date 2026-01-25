/**
 * @fileoverview Conversation Management Module
 * @description Context window management, message truncation, and token counting
 * @module @wrap-nebula/core/agent/conversation
 * @version 1.0.0
 * @author WRAP Nebula Team
 * @license MIT
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Message,
  ContentPart,
  TextContent,
  UsageStats,
  AgentMemoryConfig,
} from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Truncation strategy type.
 */
export type TruncationStrategy = 'truncate' | 'summarize' | 'sliding' | 'priority';

/**
 * Message priority level.
 */
export type MessagePriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Message with priority metadata.
 */
interface PrioritizedMessage extends Message {
  priority: MessagePriority;
  tokenCount: number;
  index: number;
}

/**
 * Context window configuration.
 */
interface ContextWindowConfig {
  /** Maximum tokens in context window */
  maxTokens: number;
  /** Reserved tokens for response */
  reservedTokens: number;
  /** System message reserved tokens */
  systemReservedTokens: number;
}

/**
 * Summarization options.
 */
interface SummarizeOptions {
  /** Maximum tokens for summary */
  maxSummaryTokens: number;
  /** Minimum messages to summarize */
  minMessages: number;
  /** Whether to include message timestamps */
  includeTimestamps: boolean;
}

/**
 * Truncation result.
 */
interface TruncationResult {
  /** Remaining messages after truncation */
  messages: Message[];
  /** Total tokens remaining */
  totalTokens: number;
  /** Number of messages removed */
  removedCount: number;
  /** Whether truncation occurred */
  wasTruncated: boolean;
  /** Summary of removed messages (if applicable) */
  summary?: string;
}

/**
 * Conversation statistics.
 */
interface ConversationStats {
  /** Total message count */
  messageCount: number;
  /** Total token count */
  totalTokens: number;
  /** Messages by role */
  messagesByRole: Record<string, number>;
  /** Average message length in tokens */
  averageMessageLength: number;
  /** Oldest message timestamp */
  oldestMessage?: number;
  /** Newest message timestamp */
  newestMessage?: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default context window configuration.
 */
const DEFAULT_CONTEXT_CONFIG: ContextWindowConfig = {
  maxTokens: 128000,
  reservedTokens: 4096,
  systemReservedTokens: 1024,
};

/**
 * Default summarization options.
 */
const DEFAULT_SUMMARIZE_OPTIONS: SummarizeOptions = {
  maxSummaryTokens: 512,
  minMessages: 5,
  includeTimestamps: false,
};

/**
 * Role priority weights for truncation decisions.
 */
const ROLE_PRIORITY: Record<string, number> = {
  system: 100, // Never remove system messages
  user: 3,
  assistant: 2,
  tool: 1,
  function: 1,
};

/**
 * Approximate tokens per character ratio.
 */
const TOKENS_PER_CHAR = 0.25;

// ============================================================================
// Token Counter
// ============================================================================

/**
 * Token counting utilities.
 */
export class TokenCounter {
  private cache: Map<string, number> = new Map();
  private maxCacheSize: number = 1000;

  /**
   * Count tokens in text.
   * Uses approximation if no tokenizer is available.
   */
  countText(text: string): number {
    // Check cache
    const cached = this.cache.get(text);
    if (cached !== undefined) {
      return cached;
    }

    // Approximate token count
    // This is a rough approximation; for accurate counting,
    // use a proper tokenizer like tiktoken
    const count = this.approximateTokens(text);

    // Cache the result
    if (this.cache.size >= this.maxCacheSize) {
      // Evict oldest entries
      const keys = Array.from(this.cache.keys()).slice(0, 100);
      for (const key of keys) {
        this.cache.delete(key);
      }
    }
    this.cache.set(text, count);

    return count;
  }

  /**
   * Count tokens in a message.
   */
  countMessage(message: Message): number {
    // Use cached token count if available
    if (message.tokenCount !== undefined) {
      return message.tokenCount;
    }

    let count = 0;

    // Count content tokens
    if (typeof message.content === 'string') {
      count += this.countText(message.content);
    } else {
      for (const part of message.content) {
        count += this.countContentPart(part);
      }
    }

    // Add overhead for role and metadata
    count += 4; // Role tokens overhead
    if (message.name) {
      count += this.countText(message.name) + 2;
    }

    return count;
  }

  /**
   * Count tokens in a content part.
   */
  countContentPart(part: ContentPart): number {
    switch (part.type) {
      case 'text':
        return this.countText(part.text);
      case 'image':
        // Image tokens depend on detail level and size
        return part.detail === 'high' ? 765 : 85;
      case 'audio':
        // Audio tokens depend on duration
        return Math.ceil((part.duration ?? 60) * 10);
      case 'video':
        // Video tokens depend on duration
        return Math.ceil((part.duration ?? 60) * 100);
      case 'file':
        // File tokens depend on size
        return Math.ceil(part.size / 1000);
      case 'code':
        return this.countText(part.code);
      case 'thinking':
        return this.countText(part.thinking);
      case 'tool_use':
        return this.countText(JSON.stringify(part.input)) + 10;
      case 'tool_result':
        return this.countText(typeof part.content === 'string' ? part.content : JSON.stringify(part.content)) + 5;
      case 'function_call':
        return this.countText(part.arguments) + 10;
      case 'function_result':
        return this.countText(part.result) + 5;
      default:
        return 0;
    }
  }

  /**
   * Count tokens in multiple messages.
   */
  countMessages(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.countMessage(msg), 0);
  }

  /**
   * Clear the token count cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Approximate token count for text.
   */
  private approximateTokens(text: string): number {
    // More accurate approximation based on whitespace and punctuation
    const words = text.split(/\s+/).length;
    const chars = text.length;
    
    // Use a weighted combination
    return Math.ceil(words * 1.3 + chars * TOKENS_PER_CHAR * 0.5);
  }
}

// ============================================================================
// Conversation Manager
// ============================================================================

/**
 * Manages conversation context with token counting and truncation.
 * 
 * @example
 * ```typescript
 * const manager = new ConversationManager({
 *   maxTokens: 100000,
 *   strategy: 'sliding',
 * });
 * 
 * manager.addMessage({
 *   id: '1',
 *   role: 'user',
 *   content: 'Hello!',
 *   timestamp: Date.now(),
 *   status: 'complete',
 * });
 * 
 * const context = manager.getContext();
 * console.log(`Total tokens: ${context.totalTokens}`);
 * ```
 */
export class ConversationManager {
  private messages: Message[] = [];
  private config: AgentMemoryConfig;
  private contextConfig: ContextWindowConfig;
  private tokenCounter: TokenCounter;
  private summary: string | null = null;
  private conversationId: string;

  /**
   * Create a conversation manager.
   * @param config - Memory configuration
   * @param contextConfig - Context window configuration
   */
  constructor(
    config?: Partial<AgentMemoryConfig>,
    contextConfig?: Partial<ContextWindowConfig>
  ) {
    this.config = {
      enabled: true,
      maxMessages: 100,
      maxTokens: 128000,
      strategy: 'sliding',
      ...config,
    };

    this.contextConfig = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...contextConfig,
      maxTokens: this.config.maxTokens ?? DEFAULT_CONTEXT_CONFIG.maxTokens,
    };

    this.tokenCounter = new TokenCounter();
    this.conversationId = uuidv4();
  }

  /**
   * Add a message to the conversation.
   */
  addMessage(message: Message): void {
    if (!this.config.enabled) return;

    // Calculate token count
    const tokenCount = this.tokenCounter.countMessage(message);
    message.tokenCount = tokenCount;

    // Add to messages
    this.messages.push(message);

    // Enforce limits
    this.enforceLimits();
  }

  /**
   * Add multiple messages.
   */
  addMessages(messages: Message[]): void {
    for (const message of messages) {
      this.addMessage(message);
    }
  }

  /**
   * Get all messages.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get the last N messages.
   */
  getLastMessages(n: number): Message[] {
    return this.messages.slice(-n);
  }

  /**
   * Get messages within token budget.
   */
  getMessagesInBudget(maxTokens: number): Message[] {
    const availableTokens = maxTokens - this.contextConfig.reservedTokens;
    let currentTokens = 0;
    const result: Message[] = [];

    // Always include system messages
    const systemMessages = this.messages.filter(m => m.role === 'system');
    const systemTokens = this.tokenCounter.countMessages(systemMessages);
    currentTokens += systemTokens;
    result.push(...systemMessages);

    // Add other messages from newest to oldest
    const otherMessages = this.messages.filter(m => m.role !== 'system').reverse();
    
    for (const message of otherMessages) {
      const msgTokens = message.tokenCount ?? this.tokenCounter.countMessage(message);
      if (currentTokens + msgTokens <= availableTokens) {
        result.unshift(message);
        currentTokens += msgTokens;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Get total token count.
   */
  getTotalTokens(): number {
    return this.tokenCounter.countMessages(this.messages);
  }

  /**
   * Get available tokens for new messages.
   */
  getAvailableTokens(): number {
    return this.contextConfig.maxTokens - this.getTotalTokens() - this.contextConfig.reservedTokens;
  }

  /**
   * Get conversation statistics.
   */
  getStats(): ConversationStats {
    const messagesByRole: Record<string, number> = {};
    let totalTokens = 0;

    for (const message of this.messages) {
      messagesByRole[message.role] = (messagesByRole[message.role] ?? 0) + 1;
      totalTokens += message.tokenCount ?? this.tokenCounter.countMessage(message);
    }

    const timestamps = this.messages.map(m => m.timestamp).filter(Boolean);

    return {
      messageCount: this.messages.length,
      totalTokens,
      messagesByRole,
      averageMessageLength: this.messages.length > 0 
        ? Math.round(totalTokens / this.messages.length) 
        : 0,
      oldestMessage: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestMessage: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    };
  }

  /**
   * Clear the conversation.
   */
  clear(): void {
    this.messages = [];
    this.summary = null;
    this.conversationId = uuidv4();
  }

  /**
   * Truncate the conversation using the configured strategy.
   */
  truncate(maxTokens: number): TruncationResult {
    const strategy = this.config.strategy ?? 'sliding';

    switch (strategy) {
      case 'truncate':
        return this.truncateSimple(maxTokens);
      case 'sliding':
        return this.truncateSliding(maxTokens);
      case 'priority':
        return this.truncateByPriority(maxTokens);
      case 'summarize':
        return this.truncateWithSummary(maxTokens);
      default:
        return this.truncateSliding(maxTokens);
    }
  }

  /**
   * Get the conversation summary.
   */
  getSummary(): string | null {
    return this.summary;
  }

  /**
   * Set a conversation summary.
   */
  setSummary(summary: string): void {
    this.summary = summary;
  }

  /**
   * Get the conversation ID.
   */
  getConversationId(): string {
    return this.conversationId;
  }

  /**
   * Export conversation as JSON.
   */
  export(): string {
    return JSON.stringify({
      conversationId: this.conversationId,
      messages: this.messages,
      summary: this.summary,
      stats: this.getStats(),
    });
  }

  /**
   * Import conversation from JSON.
   */
  import(json: string): void {
    try {
      const data = JSON.parse(json);
      this.conversationId = data.conversationId ?? uuidv4();
      this.messages = data.messages ?? [];
      this.summary = data.summary ?? null;
    } catch (error) {
      throw new Error(`Failed to import conversation: ${(error as Error).message}`);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Enforce message and token limits.
   */
  private enforceLimits(): void {
    // Enforce message limit
    if (this.messages.length > (this.config.maxMessages ?? 100)) {
      const keepCount = this.config.maxMessages ?? 100;
      const systemMessages = this.messages.filter(m => m.role === 'system');
      const otherMessages = this.messages.filter(m => m.role !== 'system');
      
      this.messages = [
        ...systemMessages,
        ...otherMessages.slice(-(keepCount - systemMessages.length)),
      ];
    }

    // Enforce token limit
    const maxTokens = this.contextConfig.maxTokens - this.contextConfig.reservedTokens;
    if (this.getTotalTokens() > maxTokens) {
      const result = this.truncate(maxTokens);
      this.messages = result.messages;
    }
  }

  /**
   * Simple truncation - remove oldest messages.
   */
  private truncateSimple(maxTokens: number): TruncationResult {
    const originalCount = this.messages.length;
    const systemMessages = this.messages.filter(m => m.role === 'system');
    let otherMessages = this.messages.filter(m => m.role !== 'system');

    // Remove from the beginning
    let totalTokens = this.tokenCounter.countMessages(this.messages);

    while (totalTokens > maxTokens && otherMessages.length > 0) {
      const removed = otherMessages.shift()!;
      totalTokens -= removed.tokenCount ?? this.tokenCounter.countMessage(removed);
    }

    return {
      messages: [...systemMessages, ...otherMessages],
      totalTokens,
      removedCount: originalCount - systemMessages.length - otherMessages.length,
      wasTruncated: originalCount > systemMessages.length + otherMessages.length,
    };
  }

  /**
   * Sliding window truncation.
   */
  private truncateSliding(maxTokens: number): TruncationResult {
    const result = this.truncateSimple(maxTokens);
    return result;
  }

  /**
   * Priority-based truncation.
   */
  private truncateByPriority(maxTokens: number): TruncationResult {
    const originalCount = this.messages.length;
    
    // Calculate priorities
    const prioritized: PrioritizedMessage[] = this.messages.map((msg, index) => ({
      ...msg,
      priority: this.getMessagePriority(msg),
      tokenCount: msg.tokenCount ?? this.tokenCounter.countMessage(msg),
      index,
    }));

    // Sort by priority (higher first)
    prioritized.sort((a, b) => {
      // System messages always first
      if (a.role === 'system' && b.role !== 'system') return -1;
      if (b.role === 'system' && a.role !== 'system') return 1;

      // Then by priority
      const priorityDiff = this.priorityWeight(b.priority) - this.priorityWeight(a.priority);
      if (priorityDiff !== 0) return priorityDiff;

      // Then by recency (newer first)
      return b.index - a.index;
    });

    // Keep highest priority messages within budget
    const kept: Message[] = [];
    let totalTokens = 0;

    for (const msg of prioritized) {
      if (totalTokens + msg.tokenCount <= maxTokens) {
        kept.push(msg);
        totalTokens += msg.tokenCount;
      }
    }

    // Sort back to original order
    kept.sort((a, b) => (a as PrioritizedMessage).index - (b as PrioritizedMessage).index);

    return {
      messages: kept,
      totalTokens,
      removedCount: originalCount - kept.length,
      wasTruncated: originalCount > kept.length,
    };
  }

  /**
   * Truncation with summarization.
   */
  private truncateWithSummary(maxTokens: number): TruncationResult {
    const options = DEFAULT_SUMMARIZE_OPTIONS;
    const systemMessages = this.messages.filter(m => m.role === 'system');
    let otherMessages = this.messages.filter(m => m.role !== 'system');

    // Check if we have enough messages to summarize
    if (otherMessages.length < options.minMessages) {
      return this.truncateSliding(maxTokens);
    }

    // Calculate tokens for summary
    const summaryTokens = options.maxSummaryTokens;
    const availableForMessages = maxTokens - summaryTokens - this.tokenCounter.countMessages(systemMessages);

    // Keep the most recent messages
    const keptMessages: Message[] = [];
    let keptTokens = 0;

    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i]!;
      const msgTokens = msg.tokenCount ?? this.tokenCounter.countMessage(msg);
      
      if (keptTokens + msgTokens <= availableForMessages) {
        keptMessages.unshift(msg);
        keptTokens += msgTokens;
      } else {
        break;
      }
    }

    // Generate summary for removed messages
    const removedMessages = otherMessages.slice(0, otherMessages.length - keptMessages.length);
    const summary = this.generateSummary(removedMessages, options);

    // Create summary message
    const summaryMessage: Message = {
      id: uuidv4(),
      role: 'system',
      content: `Previous conversation summary:\n${summary}`,
      timestamp: Date.now(),
      status: 'complete',
      tokenCount: this.tokenCounter.countText(summary) + 10,
    };

    return {
      messages: [...systemMessages, summaryMessage, ...keptMessages],
      totalTokens: this.tokenCounter.countMessages([...systemMessages, summaryMessage, ...keptMessages]),
      removedCount: removedMessages.length,
      wasTruncated: removedMessages.length > 0,
      summary,
    };
  }

  /**
   * Get message priority.
   */
  private getMessagePriority(message: Message): MessagePriority {
    // System messages are critical
    if (message.role === 'system') return 'critical';

    // Check for important keywords
    const content = typeof message.content === 'string' 
      ? message.content 
      : message.content.map(p => p.type === 'text' ? p.text : '').join(' ');

    const lowerContent = content.toLowerCase();

    // High priority keywords
    if (lowerContent.includes('important') || lowerContent.includes('remember') || 
        lowerContent.includes('critical') || lowerContent.includes('essential')) {
      return 'high';
    }

    // Low priority for very short messages
    if (content.length < 20) {
      return 'low';
    }

    return 'normal';
  }

  /**
   * Get priority weight for sorting.
   */
  private priorityWeight(priority: MessagePriority): number {
    const weights: Record<MessagePriority, number> = {
      critical: 4,
      high: 3,
      normal: 2,
      low: 1,
    };
    return weights[priority] ?? 2;
  }

  /**
   * Generate a summary of messages.
   */
  private generateSummary(messages: Message[], options: SummarizeOptions): string {
    const parts: string[] = [];

    for (const message of messages) {
      const content = typeof message.content === 'string' 
        ? message.content 
        : message.content.map(p => p.type === 'text' ? p.text : `[${p.type}]`).join(' ');

      let prefix = `[${message.role}]`;
      if (options.includeTimestamps && message.timestamp) {
        prefix += ` (${new Date(message.timestamp).toISOString()})`;
      }

      parts.push(`${prefix} ${content}`);
    }

    return parts.join('\n');
  }
}

// ============================================================================
// Context Builder
// ============================================================================

/**
 * Builder for constructing conversation context.
 */
export class ContextBuilder {
  private messages: Message[] = [];
  private systemPrompt: string | null = null;
  private tokenCounter: TokenCounter;

  constructor() {
    this.tokenCounter = new TokenCounter();
  }

  /**
   * Set the system prompt.
   */
  system(content: string): this {
    this.systemPrompt = content;
    return this;
  }

  /**
   * Add a user message.
   */
  user(content: string | ContentPart[]): this {
    this.messages.push({
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: Date.now(),
      status: 'complete',
    });
    return this;
  }

  /**
   * Add an assistant message.
   */
  assistant(content: string | ContentPart[]): this {
    this.messages.push({
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      status: 'complete',
    });
    return this;
  }

  /**
   * Add a tool result message.
   */
  tool(name: string, content: string): this {
    this.messages.push({
      id: uuidv4(),
      role: 'tool',
      content,
      name,
      timestamp: Date.now(),
      status: 'complete',
    });
    return this;
  }

  /**
   * Add a raw message.
   */
  addMessage(message: Message): this {
    this.messages.push(message);
    return this;
  }

  /**
   * Build the message array.
   */
  build(): Message[] {
    const result: Message[] = [];

    // Add system message first
    if (this.systemPrompt) {
      result.push({
        id: uuidv4(),
        role: 'system',
        content: this.systemPrompt,
        timestamp: Date.now(),
        status: 'complete',
      });
    }

    result.push(...this.messages);
    return result;
  }

  /**
   * Build with token limit.
   */
  buildWithLimit(maxTokens: number): Message[] {
    const allMessages = this.build();
    
    if (this.tokenCounter.countMessages(allMessages) <= maxTokens) {
      return allMessages;
    }

    // Truncate to fit
    const systemMessage = allMessages.find(m => m.role === 'system');
    const otherMessages = allMessages.filter(m => m.role !== 'system');

    let tokens = systemMessage ? this.tokenCounter.countMessage(systemMessage) : 0;
    const result: Message[] = systemMessage ? [systemMessage] : [];

    // Keep most recent messages
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i]!;
      const msgTokens = this.tokenCounter.countMessage(msg);
      
      if (tokens + msgTokens <= maxTokens) {
        result.splice(systemMessage ? 1 : 0, 0, msg);
        tokens += msgTokens;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Clear the builder.
   */
  clear(): this {
    this.messages = [];
    this.systemPrompt = null;
    return this;
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  TokenCounter,
  ConversationManager,
  ContextBuilder,
  DEFAULT_CONTEXT_CONFIG,
  DEFAULT_SUMMARIZE_OPTIONS,
  ROLE_PRIORITY,
  TOKENS_PER_CHAR,
};

export type {
  TruncationStrategy,
  MessagePriority,
  PrioritizedMessage,
  ContextWindowConfig,
  SummarizeOptions,
  TruncationResult,
  ConversationStats,
};

/**
 * WRAP NEBULA Core - Conversation Memory
 * Cross-session memory for persistent conversations
 */

import * as crypto from 'crypto';
import { StateManager } from '../state/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    channel?: string;
    channelId?: string;
    userId?: string;
    tokens?: number;
    model?: string;
  };
}

export interface Conversation {
  id: string;
  userId: string;
  channelId: string;
  channelType: 'telegram' | 'discord' | 'web';
  messages: ConversationMessage[];
  context: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  messageCount: number;
  summary?: string;
}

export interface ConversationMemoryConfig {
  maxMessages?: number;
  conversationTTL?: number;
  enableSummaries?: boolean;
  stateManager?: StateManager;
}

// ============================================================================
// Conversation Memory Implementation
// ============================================================================

export class ConversationMemory {
  private config: Required<Omit<ConversationMemoryConfig, 'stateManager'>> & { stateManager: StateManager };
  private stateManager: StateManager;
  private conversationPrefix = 'conv:';

  constructor(config: ConversationMemoryConfig = {}) {
    this.config = {
      maxMessages: config.maxMessages || 100,
      conversationTTL: config.conversationTTL || 30 * 24 * 60 * 60 * 1000,
      enableSummaries: config.enableSummaries ?? true,
      stateManager: config.stateManager || new StateManager({ backend: 'file' }),
    };
    this.stateManager = this.config.stateManager;
  }

  async initialize(): Promise<void> {
    await this.stateManager.initialize();
  }

  async close(): Promise<void> {
    await this.stateManager.close();
  }

  // ==========================================================================
  // Conversation Management
  // ==========================================================================

  async createConversation(
    userId: string,
    channelId: string,
    channelType: 'telegram' | 'discord' | 'web'
  ): Promise<Conversation> {
    const now = Date.now();
    const conversation: Conversation = {
      id: this.generateConversationId(userId, channelId),
      userId,
      channelId,
      channelType,
      messages: [],
      context: {},
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0,
    };

    await this.saveConversation(conversation);
    return conversation;
  }

  async getConversation(userId: string, channelId: string): Promise<Conversation | null> {
    const id = this.generateConversationId(userId, channelId);
    const key = `${this.conversationPrefix}${id}`;
    const data = await this.stateManager.get(key);
    
    if (!data) return null;
    return data as Conversation;
  }

  async getOrCreateConversation(
    userId: string,
    channelId: string,
    channelType: 'telegram' | 'discord' | 'web'
  ): Promise<Conversation> {
    const existing = await this.getConversation(userId, channelId);
    if (existing) return existing;
    return this.createConversation(userId, channelId, channelType);
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const key = `${this.conversationPrefix}${conversation.id}`;
    await this.stateManager.set(key, conversation, {
      ttl: this.config.conversationTTL,
      tags: ['conversation', conversation.channelType, conversation.userId],
    });
  }

  async deleteConversation(userId: string, channelId: string): Promise<boolean> {
    const id = this.generateConversationId(userId, channelId);
    const key = `${this.conversationPrefix}${id}`;
    return this.stateManager.delete(key);
  }

  // ==========================================================================
  // Message Management
  // ==========================================================================

  async addMessage(
    userId: string,
    channelId: string,
    channelType: 'telegram' | 'discord' | 'web',
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: ConversationMessage['metadata']
  ): Promise<ConversationMessage> {
    const conversation = await this.getOrCreateConversation(userId, channelId, channelType);

    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: Date.now(),
      metadata,
    };

    conversation.messages.push(message);
    conversation.messageCount++;
    conversation.updatedAt = Date.now();
    conversation.lastMessageAt = message.timestamp;

    // Trim old messages if exceeding max
    if (conversation.messages.length > this.config.maxMessages) {
      const removed = conversation.messages.length - this.config.maxMessages;
      conversation.messages = conversation.messages.slice(removed);
    }

    // Generate summary if enabled and messages exceed threshold
    if (this.config.enableSummaries && conversation.messageCount % 50 === 0) {
      conversation.summary = await this.generateSummary(conversation);
    }

    await this.saveConversation(conversation);
    return message;
  }

  async getRecentMessages(
    userId: string,
    channelId: string,
    limit: number = 20
  ): Promise<ConversationMessage[]> {
    const conversation = await this.getConversation(userId, channelId);
    if (!conversation) return [];
    return conversation.messages.slice(-limit);
  }

  async getConversationHistory(
    userId: string,
    channelId: string
  ): Promise<ConversationMessage[]> {
    const conversation = await this.getConversation(userId, channelId);
    if (!conversation) return [];
    return conversation.messages;
  }

  // ==========================================================================
  // Context Management (for agent memory)
  // ==========================================================================

  async setContext(
    userId: string,
    channelId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    const conversation = await this.getConversation(userId, channelId);
    if (conversation) {
      conversation.context[key] = value;
      await this.saveConversation(conversation);
    }
  }

  async getContext(
    userId: string,
    channelId: string,
    key: string
  ): Promise<unknown | undefined> {
    const conversation = await this.getConversation(userId, channelId);
    if (!conversation) return undefined;
    return conversation.context[key];
  }

  async getAllContext(
    userId: string,
    channelId: string
  ): Promise<Record<string, unknown>> {
    const conversation = await this.getConversation(userId, channelId);
    if (!conversation) return {};
    return { ...conversation.context };
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  async searchMessages(
    query: string,
    options: { userId?: string; channelType?: 'telegram' | 'discord' | 'web' } = {}
  ): Promise<Array<{ conversation: Conversation; matches: ConversationMessage[] }>> {
    const entries = await this.stateManager.findByPattern(
      `${this.conversationPrefix}*`
    );
    const results: Array<{ conversation: Conversation; matches: ConversationMessage[] }> = [];
    const queryLower = query.toLowerCase();

    for (const entry of entries) {
      const conv = entry.value as Conversation;

      if (options.userId && conv.userId !== options.userId) continue;
      if (options.channelType && conv.channelType !== options.channelType) continue;

      const matches = conv.messages.filter(
        msg => msg.content.toLowerCase().includes(queryLower)
      );

      if (matches.length > 0) {
        results.push({ conversation: conv, matches });
      }
    }

    return results;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  async getStats(userId?: string): Promise<{
    totalConversations: number;
    totalMessages: number;
    byChannel: Record<string, number>;
    oldestConversation: number | null;
    newestConversation: number | null;
  }> {
    const entries = await this.stateManager.findByPattern(
      `${this.conversationPrefix}*`
    );

    let totalConversations = 0;
    let totalMessages = 0;
    const byChannel: Record<string, number> = { telegram: 0, discord: 0, web: 0 };
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const entry of entries) {
      const conv = entry.value as Conversation;

      if (userId && conv.userId !== userId) continue;

      totalConversations++;
      totalMessages += conv.messageCount;
      byChannel[conv.channelType] = (byChannel[conv.channelType] || 0) + 1;

      if (oldest === null || conv.createdAt < oldest) oldest = conv.createdAt;
      if (newest === null || conv.createdAt > newest) newest = conv.createdAt;
    }

    return {
      totalConversations,
      totalMessages,
      byChannel,
      oldestConversation: oldest,
      newestConversation: newest,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private generateConversationId(userId: string, channelId: string): string {
    return crypto
      .createHash('sha256')
      .update(`${userId}:${channelId}`)
      .digest('hex')
      .substring(0, 16);
  }

  private async generateSummary(conversation: Conversation): Promise<string> {
    const recentMessages = conversation.messages.slice(-20);
    const userMessages = recentMessages
      .filter(m => m.role === 'user')
      .map(m => m.content.substring(0, 100))
      .join('; ');

    return `Conversation avec ${conversation.messageCount} messages. Sujets récents: ${userMessages.substring(0, 200)}`;
  }
}

// ============================================================================
// Factory & Export
// ============================================================================

export function createConversationMemory(
  config?: ConversationMemoryConfig
): ConversationMemory {
  return new ConversationMemory(config);
}

export default ConversationMemory;

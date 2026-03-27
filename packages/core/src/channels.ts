/**
 * WRAP NEBULA Core - Channel Abstraction Layer
 * Unified interface for communication channels
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported channel types
 */
export type ChannelType = 'telegram' | 'discord' | 'web' | 'cli';

/**
 * Channel status
 */
export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Base channel configuration
 */
export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  token?: string;
  webhookUrl?: string;
}

/**
 * Incoming message from any channel
 */
export interface IncomingMessage {
  /** Unique message ID */
  id: string;
  /** Channel type */
  channel: ChannelType;
  /** User ID (channel-specific) */
  userId: string;
  /** User display name */
  userName?: string;
  /** Message content */
  content: string;
  /** Timestamp */
  timestamp: number;
  /** Channel-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Outgoing message to any channel
 */
export interface OutgoingMessage {
  /** Message content */
  content: string;
  /** Parse mode (markdown, html, plain) */
  parseMode?: 'markdown' | 'html' | 'plain';
  /** Reply to message ID */
  replyTo?: string;
  /** Additional options */
  options?: Record<string, unknown>;
}

/**
 * Channel events
 */
export interface ChannelEvents {
  message: IncomingMessage;
  error: Error;
  status: { channel: ChannelType; status: ChannelStatus };
}

/**
 * Channel interface - extends EventEmitter for event handling
 */
export interface Channel extends NodeJS.EventEmitter {
  /** Channel type */
  readonly type: ChannelType;
  /** Current status */
  readonly status: ChannelStatus;
  /** Start the channel */
  start(): Promise<void>;
  /** Stop the channel */
  stop(): Promise<void>;
  /** Send a message to a user */
  send(userId: string, message: OutgoingMessage): Promise<void>;
  /** Broadcast to all users */
  broadcast(message: OutgoingMessage): Promise<void>;
}

// ============================================================================
// Base Channel Implementation
// ============================================================================

/**
 * Abstract base class for channels
 */
export abstract class BaseChannel extends EventEmitter implements Channel {
  abstract readonly type: ChannelType;
  
  protected _status: ChannelStatus = 'disconnected';
  protected config: ChannelConfig;

  constructor(config: ChannelConfig) {
    super();
    this.config = config;
  }

  get status(): ChannelStatus {
    return this._status;
  }

  protected setStatus(status: ChannelStatus): void {
    this._status = status;
    this.emit('status', { channel: this.type, status });
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(userId: string, message: OutgoingMessage): Promise<void>;
  abstract broadcast(message: OutgoingMessage): Promise<void>;

  /**
   * Emit an incoming message
   */
  protected emitMessage(message: IncomingMessage): void {
    this.emit('message', message);
  }

  /**
   * Emit an error
   */
  protected emitError(error: Error): void {
    this.emit('error', error);
  }
}

// ============================================================================
// Channel Manager
// ============================================================================

/**
 * Manages multiple channels
 */
export class ChannelManager extends EventEmitter {
  private channels: Map<ChannelType, Channel> = new Map();
  private messageHandler?: (message: IncomingMessage) => Promise<OutgoingMessage>;

  /**
   * Register a channel
   */
  register(channel: Channel): void {
    if (this.channels.has(channel.type)) {
      throw new Error(`Channel ${channel.type} already registered`);
    }

    this.channels.set(channel.type, channel);

    // Forward channel events
    channel.on('message', (msg: IncomingMessage) => {
      this.handleIncomingMessage(msg).catch(console.error);
    });

    channel.on('error', (err: Error) => {
      this.emit('error', err, channel.type);
    });

    channel.on('status', (data: { channel: ChannelType; status: ChannelStatus }) => {
      this.emit('status', data);
    });
  }

  /**
   * Unregister a channel
   */
  unregister(type: ChannelType): boolean {
    const channel = this.channels.get(type);
    if (!channel) return false;

    channel.stop().catch(console.error);
    channel.removeAllListeners();
    this.channels.delete(type);
    return true;
  }

  /**
   * Get a channel by type
   */
  get(type: ChannelType): Channel | undefined {
    return this.channels.get(type);
  }

  /**
   * Set message handler
   */
  onMessage(handler: (message: IncomingMessage) => Promise<OutgoingMessage>): void {
    this.messageHandler = handler;
  }

  /**
   * Start all channels
   */
  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const channel of this.channels.values()) {
      promises.push(channel.start());
    }

    await Promise.allSettled(promises);
  }

  /**
   * Stop all channels
   */
  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const channel of this.channels.values()) {
      promises.push(channel.stop());
    }

    await Promise.allSettled(promises);
  }

  /**
   * Handle incoming message
   */
  private async handleIncomingMessage(message: IncomingMessage): Promise<void> {
    if (!this.messageHandler) {
      console.warn('No message handler set');
      return;
    }

    try {
      const response = await this.messageHandler(message);
      
      // Send response back through the same channel
      const channel = this.channels.get(message.channel);
      if (channel) {
        await channel.send(message.userId, response);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.emit('error', error as Error, message.channel);
    }
  }

  /**
   * Get all registered channel types
   */
  getChannelTypes(): ChannelType[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get status of all channels
   */
  getStatus(): Record<ChannelType, ChannelStatus> {
    const status: Partial<Record<ChannelType, ChannelStatus>> = {};
    
    for (const [type, channel] of this.channels) {
      status[type] = channel.status;
    }

    return status as Record<ChannelType, ChannelStatus>;
  }
}

// ============================================================================
// Exports
// ============================================================================

export { EventEmitter };

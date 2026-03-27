/**
 * WRAP NEBULA Telegram Channel - Bot Entry Point
 * Telegram bot integration for NEBULA agents
 */

import { Telegraf } from 'telegraf';
import {
  rateLimitMiddleware,
  authMiddleware,
  loggingMiddleware,
  errorMiddleware,
  commandWhitelistMiddleware,
  initAllowedUsers,
} from './middleware/index.js';
import { registerHandlers } from './handlers/index.js';

// ============================================================================
// Types
// ============================================================================

export interface TelegramConfig {
  /** Telegram bot token */
  token: string;
  /** Rate limit: max messages per window */
  rateLimitMax?: number;
  /** Rate limit: window in ms */
  rateLimitWindow?: number;
  /** Allowed user IDs (empty = all allowed) */
  allowedUsers?: number[];
  /** Enable debug logging */
  debug?: boolean;
}

export interface AgentInterface {
  sendMessage: (message: string, userId: string) => Promise<string>;
  resetConversation: (userId: string) => Promise<void>;
  getStatus: () => { status: string; name: string };
}

// ============================================================================
// Telegram Channel Implementation
// ============================================================================

export class TelegramChannel {
  private bot: Telegraf;
  private config: TelegramConfig;
  private agent: AgentInterface;
  private running: boolean = false;

  constructor(config: TelegramConfig, agent: AgentInterface) {
    this.config = config;
    this.agent = agent;
    this.bot = new Telegraf(config.token);

    this.setupMiddleware();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  /**
   * Setup middleware chain
   */
  private setupMiddleware(): void {
    // Error handling first
    this.bot.use(errorMiddleware());

    // Debug logging
    if (this.config.debug) {
      this.bot.use(loggingMiddleware());
    }

    // Authentication
    if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      initAllowedUsers(this.config.allowedUsers);
      this.bot.use(authMiddleware());
    }

    // Rate limiting
    this.bot.use(
      rateLimitMiddleware(
        this.config.rateLimitMax || 5,
        this.config.rateLimitWindow || 60000
      )
    );

    // Command whitelist
    this.bot.use(commandWhitelistMiddleware());
  }

  /**
   * Setup message and command handlers
   */
  private setupHandlers(): void {
    registerHandlers(this.bot, this.agent);
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.bot.catch((err, ctx) => {
      console.error('[Telegram] Bot error:', err);
      
      if (ctx) {
        ctx.reply('❌ Une erreur est survenue.').catch(() => {});
      }
    });
  }

  /**
   * Start the bot (polling mode)
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[Telegram] Bot already running');
      return;
    }

    try {
      // Start polling
      await this.bot.launch();
      this.running = true;

      console.log('[Telegram] Bot started successfully');
      console.log('[Telegram] Using polling mode (no webhooks)');

      // Enable graceful stop
      this.setupGracefulStop();
    } catch (error) {
      console.error('[Telegram] Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.bot.stop();
    this.running = false;
    console.log('[Telegram] Bot stopped');
  }

  /**
   * Check if bot is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Send a message to a specific user
   */
  async sendToUser(userId: number, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`[Telegram] Failed to send message to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get bot info
   */
  async getBotInfo(): Promise<{
    id: number;
    username: string;
    firstName: string;
  }> {
    const me = await this.bot.telegram.getMe();
    return {
      id: me.id,
      username: me.username || 'unknown',
      firstName: me.first_name,
    };
  }

  /**
   * Setup graceful stop on process signals
   */
  private setupGracefulStop(): void {
    const stop = () => this.stop();
    
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and start a Telegram channel
 */
export async function createTelegramChannel(
  config: TelegramConfig,
  agent: AgentInterface
): Promise<TelegramChannel> {
  const channel = new TelegramChannel(config, agent);
  await channel.start();
  return channel;
}

// ============================================================================
// Default Export
// ============================================================================

export default TelegramChannel;

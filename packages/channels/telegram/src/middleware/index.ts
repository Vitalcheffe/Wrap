/**
 * WRAP NEBULA Telegram Channel - Middleware
 * Authentication and rate limiting
 */

import { Context, MiddlewareFn } from 'telegraf';

// ============================================================================
// Types
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface SessionData {
  userId: string;
  authenticated: boolean;
  lastActivity: number;
}

// ============================================================================
// Rate Limiting Middleware
// ============================================================================

const rateLimits = new Map<number, RateLimitEntry>();

/**
 * Rate limiting middleware (5 messages per minute by default)
 */
export function rateLimitMiddleware(
  maxRequests: number = 5,
  windowMs: number = 60000
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return next();
    }

    const now = Date.now();
    const entry = rateLimits.get(userId);

    if (!entry || now > entry.resetAt) {
      // Reset or create new entry
      rateLimits.set(userId, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next();
    }

    if (entry.count >= maxRequests) {
      const remainingMs = entry.resetAt - now;
      await ctx.reply(
        `⚠️ Trop de messages. Attends ${Math.ceil(remainingMs / 1000)} secondes.`
      );
      return;
    }

    entry.count++;
    return next();
  };
}

// ============================================================================
// Authentication Middleware
// ============================================================================

const sessions = new Map<number, SessionData>();
const ALLOWED_USERS = new Set<number>();

/**
 * Initialize allowed users from environment
 */
export function initAllowedUsers(userIds: number[]): void {
  userIds.forEach(id => ALLOWED_USERS.add(id));
}

/**
 * Authentication middleware
 */
export function authMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    // Check if user is allowed
    if (ALLOWED_USERS.size > 0 && !ALLOWED_USERS.has(userId)) {
      await ctx.reply('⛔ Accès non autorisé.');
      return;
    }

    // Update session
    sessions.set(userId, {
      userId: userId.toString(),
      authenticated: true,
      lastActivity: Date.now(),
    });

    return next();
  };
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(userId: number): boolean {
  const session = sessions.get(userId);
  return session?.authenticated ?? false;
}

/**
 * Get user session
 */
export function getSession(userId: number): SessionData | undefined {
  return sessions.get(userId);
}

// ============================================================================
// Logging Middleware
// ============================================================================

/**
 * Logging middleware for debugging
 */
export function loggingMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'anonymous';
    const message = ctx.message;

    console.log(`[Telegram] User ${userId} (@${username}):`, 
      message && 'text' in message ? message.text : '[non-text message]');

    return next();
  };
}

// ============================================================================
// Error Handling Middleware
// ============================================================================

/**
 * Error handling middleware
 */
export function errorMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    try {
      return next();
    } catch (error) {
      console.error('[Telegram] Error:', error);
      
      try {
        await ctx.reply(
          '❌ Une erreur est survenue. Réessaie dans un instant.'
        );
      } catch (replyError) {
        console.error('[Telegram] Failed to send error message:', replyError);
      }
    }
  };
}

// ============================================================================
// Command Whitelist Middleware
// ============================================================================

const ALLOWED_COMMANDS = new Set(['/start', '/help', '/status', '/reset']);

/**
 * Command whitelist middleware
 */
export function commandWhitelistMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const message = ctx.message;
    if (!message || !('text' in message)) {
      return next();
    }

    const text = message.text;
    if (text.startsWith('/')) {
      const command = text.split(' ')[0].toLowerCase();
      if (!ALLOWED_COMMANDS.has(command)) {
        await ctx.reply(
          `⚠️ Commande inconnue: ${command}\nUtilise /help pour voir les commandes disponibles.`
        );
        return;
      }
    }

    return next();
  };
}

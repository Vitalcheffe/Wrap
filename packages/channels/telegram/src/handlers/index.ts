/**
 * WRAP NEBULA Telegram Channel - Message Handlers
 * Handle incoming messages and commands
 */

import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';

// ============================================================================
// Types
// ============================================================================

interface AgentClient {
  sendMessage: (message: string, userId: string) => Promise<string>;
  resetConversation: (userId: string) => Promise<void>;
  getStatus: () => { status: string; name: string };
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Handle /start command
 */
export function handleStart(agent: AgentClient) {
  return async (ctx: Context): Promise<void> => {
    const status = agent.getStatus();
    const userName = ctx.from?.first_name || 'Utilisateur';

    await ctx.reply(
      `🌟 *Bienvenue ${userName} !*\n\n` +
      `Je suis *${status.name}*, ton agent NEBULA personnel.\n\n` +
      `Je peux t'aider avec :\n` +
      `• 🔍 Recherches web\n` +
      `• 📁 Lecture de fichiers\n` +
      `• 💻 Exécution de code\n` +
      `• ⏰ Rappels et plus encore\n\n` +
      `Envoie-moi un message pour commencer !`,
      { parse_mode: 'Markdown' }
    );
  };
}

/**
 * Handle /help command
 */
export function handleHelp() {
  return async (ctx: Context): Promise<void> => {
    await ctx.reply(
      `📚 *Commandes disponibles*\n\n` +
      `/start - Démarrer une conversation\n` +
      `/help - Afficher cette aide\n` +
      `/status - État de l'agent\n` +
      `/reset - Réinitialiser la conversation\n\n` +
      `_Tu peux aussi m'envoyer n'importe quel message et je ferai de mon mieux pour t'aider !_`,
      { parse_mode: 'Markdown' }
    );
  };
}

/**
 * Handle /status command
 */
export function handleStatus(agent: AgentClient) {
  return async (ctx: Context): Promise<void> => {
    const status = agent.getStatus();
    
    await ctx.reply(
      `📊 *État de l'agent*\n\n` +
      `• Nom: ${status.name}\n` +
      `• Statut: ${status.status}\n` +
      `• Version: 1.0.0\n\n` +
      `_Tout fonctionne correctement !_`,
      { parse_mode: 'Markdown' }
    );
  };
}

/**
 * Handle /reset command
 */
export function handleReset(agent: AgentClient) {
  return async (ctx: Context): Promise<void> => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    await agent.resetConversation(userId);
    
    await ctx.reply(
      '🔄 Conversation réinitialisée. Commençons une nouvelle discussion !',
      { parse_mode: 'Markdown' }
    );
  };
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Handle text messages
 */
export function handleMessage(agent: AgentClient) {
  return async (ctx: Context): Promise<void> => {
    // Type guard for text message
    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    const text = ctx.message.text;

    // Ignore commands (handled separately)
    if (text.startsWith('/')) {
      return;
    }

    // Show typing indicator
    await ctx.sendChatAction('typing');

    try {
      // Send to agent and get response
      const response = await agent.sendMessage(text, userId);

      // Send response with markdown support
      await ctx.reply(response, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('[Telegram] Error processing message:', error);
      await ctx.reply(
        '❌ Désolé, une erreur est survenue lors du traitement de ton message.'
      );
    }
  };
}

// ============================================================================
// Register Handlers
// ============================================================================

/**
 * Register all handlers with the bot
 */
export function registerHandlers(
  bot: Telegraf,
  agent: AgentClient
): void {
  // Command handlers
  bot.command('start', handleStart(agent));
  bot.command('help', handleHelp());
  bot.command('status', handleStatus(agent));
  bot.command('reset', handleReset(agent));

  // Message handler
  bot.on(message('text'), handleMessage(agent));
}

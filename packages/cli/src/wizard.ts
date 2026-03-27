/**
 * WRAP NEBULA CLI - Interactive Onboarding Wizard
 * Guided setup for beginners
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager, NebulaConfig, ModelConfig, ChannelConfig } from './config.js';

// ============================================================================
// Types
// ============================================================================

interface WizardAnswers {
  model: 'anthropic' | 'openai' | 'ollama';
  apiKey?: string;
  channels: ('telegram' | 'discord' | 'web')[];
  telegramToken?: string;
  discordToken?: string;
  agentName: string;
  language: string;
}

// ============================================================================
// Wizard Implementation
// ============================================================================

export class OnboardingWizard {
  private configManager: ConfigManager;
  private startTime: number = 0;

  constructor() {
    this.configManager = new ConfigManager();
  }

  /**
   * Display welcome banner
   */
  private displayBanner(): void {
    console.log();
    console.log(chalk.cyan('╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║') + chalk.white.bold('                    🌌 WRAP NEBULA v5                      ') + chalk.cyan('║'));
    console.log(chalk.cyan('║') + chalk.gray('            First Contact - Configuration Wizard            ') + chalk.cyan('║'));
    console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝'));
    console.log();
    console.log(chalk.gray('  Bienvenue ! Configurons ton agent en quelques étapes.'));
    console.log();
  }

  /**
   * Display completion message
   */
  private displayComplete(duration: number): void {
    console.log();
    console.log(chalk.green('  ✓ Configuration terminée en ') + chalk.white.bold(`${duration}`) + chalk.green(' secondes.'));
    console.log();
    console.log(chalk.gray('  Fichiers créés:'));
    console.log(chalk.gray('    • ') + chalk.white('~/.nebula/config.yaml'));
    console.log(chalk.gray('    • ') + chalk.white('~/.nebula/SOUL.md'));
    console.log();
    console.log(chalk.cyan('  Prochaines étapes:'));
    console.log(chalk.gray('    1. ') + chalk.white('nebula start') + chalk.gray(' - Démarrer ton agent'));
    console.log(chalk.gray('    2. ') + chalk.white('nebula status') + chalk.gray(' - Voir l\'état de l\'agent'));
    console.log(chalk.gray('    3. ') + chalk.white('nebula config') + chalk.gray(' - Modifier la configuration'));
    console.log();
  }

  /**
   * Run the onboarding wizard
   */
  async run(): Promise<NebulaConfig | null> {
    this.startTime = Date.now();
    this.displayBanner();

    try {
      // Step 1: Model Selection
      const modelAnswers = await this.promptModelSelection();

      // Step 2: API Key
      const apiKeyAnswers = await this.promptApiKey(modelAnswers.model);

      // Step 3: Channels
      const channelAnswers = await this.promptChannels();

      // Step 4: Channel Tokens (if needed)
      const tokenAnswers = await this.promptChannelTokens(channelAnswers.channels);

      // Step 5: Agent Personalization
      const agentAnswers = await this.promptAgentConfig();

      // Combine all answers
      const answers: WizardAnswers = {
        ...modelAnswers,
        ...apiKeyAnswers,
        ...channelAnswers,
        ...tokenAnswers,
        ...agentAnswers,
      };

      // Build and save config
      const spinner = ora(chalk.gray('Création de la configuration...')).start();
      const config = this.buildConfig(answers);
      this.configManager.save(config);

      // Create default SOUL.md
      if (!this.configManager.soulExists()) {
        this.configManager.createDefaultSoul();
      }

      spinner.succeed(chalk.green('Configuration créée !'));

      // Display completion
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      this.displayComplete(duration);

      return config;
    } catch (error) {
      if ((error as Error).message === 'User force closed the prompt') {
        console.log(chalk.yellow('\n  Configuration annulée.'));
        return null;
      }
      throw error;
    }
  }

  /**
   * Prompt for model selection
   */
  private async promptModelSelection(): Promise<{ model: 'anthropic' | 'openai' | 'ollama' }> {
    console.log(chalk.white.bold('  📦 Quel modèle veux-tu utiliser ?'));
    console.log();

    const { model } = await inquirer.prompt<{
      model: 'anthropic' | 'openai' | 'ollama';
    }>([
      {
        type: 'list',
        name: 'model',
        message: 'Modèle',
        choices: [
          {
            name: `${chalk.cyan('Claude')} (Anthropic) ${chalk.gray('— recommandé')}`,
            value: 'anthropic',
            short: 'Claude',
          },
          {
            name: `${chalk.green('GPT-4')} (OpenAI)`,
            value: 'openai',
            short: 'GPT-4',
          },
          {
            name: `${chalk.magenta('Llama 3')} local ${chalk.gray('— gratuit, offline')}`,
            value: 'ollama',
            short: 'Llama 3',
          },
        ],
        default: 'anthropic',
      },
    ]);

    console.log();
    return { model };
  }

  /**
   * Prompt for API key
   */
  private async promptApiKey(model: string): Promise<{ apiKey?: string }> {
    // Ollama doesn't need API key
    if (model === 'ollama') {
      console.log(chalk.gray('  🦙 Llama 3 fonctionne en local, pas de clé API nécessaire.'));
      console.log();
      return {};
    }

    console.log(chalk.white.bold('  🔑 Colle ta clé API'));

    const keyUrl = model === 'anthropic'
      ? 'https://console.anthropic.com'
      : 'https://platform.openai.com/api-keys';

    console.log(chalk.gray(`     Pas de clé ? → ${keyUrl}`));
    console.log();

    const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Clé API',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'La clé API est requise';
          }
          if (model === 'anthropic' && !input.startsWith('sk-ant-')) {
            return 'Format invalide. Les clés Anthropic commencent par "sk-ant-"';
          }
          if (model === 'openai' && !input.startsWith('sk-')) {
            return 'Format invalide. Les clés OpenAI commencent par "sk-"';
          }
          return true;
        },
      },
    ]);

    console.log();
    return { apiKey };
  }

  /**
   * Prompt for communication channels
   */
  private async promptChannels(): Promise<{ channels: ('telegram' | 'discord' | 'web')[] }> {
    console.log(chalk.white.bold('  💬 Par où veux-tu parler à ton agent ?'));
    console.log();

    const { channels } = await inquirer.prompt<{
      channels: ('telegram' | 'discord' | 'web')[];
    }>([
      {
        type: 'checkbox',
        name: 'channels',
        message: 'Canaux',
        choices: [
          {
            name: `${chalk.blue('Telegram')} ${chalk.gray('— recommandé pour débutants')}`,
            value: 'telegram',
            short: 'Telegram',
            checked: true,
          },
          {
            name: `${chalk.magenta('Discord')}`,
            value: 'discord',
            short: 'Discord',
            checked: true,
          },
          {
            name: `${chalk.cyan('Interface web')}`,
            value: 'web',
            short: 'Web',
            checked: false,
          },
        ],
        validate: (input: string[]) => {
          if (input.length === 0) {
            return 'Sélectionne au moins un canal';
          }
          return true;
        },
      },
    ]);

    console.log();
    return { channels };
  }

  /**
   * Prompt for channel tokens
   */
  private async promptChannelTokens(
    channels: ('telegram' | 'discord' | 'web')[]
  ): Promise<{ telegramToken?: string; discordToken?: string }> {
    const result: { telegramToken?: string; discordToken?: string } = {};

    if (channels.includes('telegram')) {
      console.log(chalk.white.bold('  📱 Token Telegram Bot'));
      console.log(chalk.gray('     Créer un bot: https://t.me/BotFather'));
      console.log();

      const { telegramToken } = await inquirer.prompt<{ telegramToken: string }>([
        {
          type: 'password',
          name: 'telegramToken',
          message: 'Token du bot Telegram',
          mask: '*',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Le token est requis';
            }
            return true;
          },
        },
      ]);

      result.telegramToken = telegramToken;
      console.log();
    }

    if (channels.includes('discord')) {
      console.log(chalk.white.bold('  🎮 Token Discord Bot'));
      console.log(chalk.gray('     Créer un bot: https://discord.com/developers/applications'));
      console.log();

      const { discordToken } = await inquirer.prompt<{ discordToken: string }>([
        {
          type: 'password',
          name: 'discordToken',
          message: 'Token du bot Discord',
          mask: '*',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Le token est requis';
            }
            return true;
          },
        },
      ]);

      result.discordToken = discordToken;
      console.log();
    }

    return result;
  }

  /**
   * Prompt for agent configuration
   */
  private async promptAgentConfig(): Promise<{ agentName: string; language: string }> {
    console.log(chalk.white.bold('  🤖 Personnalisation de l\'agent'));
    console.log();

    const { agentName, language } = await inquirer.prompt<{
      agentName: string;
      language: string;
    }>([
      {
        type: 'input',
        name: 'agentName',
        message: 'Nom de ton agent',
        default: 'Aria',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Le nom est requis';
          }
          if (input.length > 20) {
            return 'Maximum 20 caractères';
          }
          return true;
        },
      },
      {
        type: 'list',
        name: 'language',
        message: 'Langue préférée',
        choices: [
          { name: 'Français', value: 'Français' },
          { name: 'English', value: 'English' },
          { name: 'Español', value: 'Español' },
          { name: 'Deutsch', value: 'Deutsch' },
        ],
        default: 'Français',
      },
    ]);

    console.log();
    return { agentName, language };
  }

  /**
   * Build configuration from answers
   */
  private buildConfig(answers: WizardAnswers): NebulaConfig {
    // Build model config
    const modelConfig: ModelConfig = {
      provider: answers.model,
      model: this.getDefaultModel(answers.model),
      apiKey: answers.apiKey,
    };

    // Build channel configs
    const channelConfigs: ChannelConfig[] = answers.channels.map((channel) => {
      const config: ChannelConfig = {
        type: channel,
        enabled: true,
      };

      if (channel === 'telegram') {
        config.token = answers.telegramToken;
      } else if (channel === 'discord') {
        config.token = answers.discordToken;
      }

      return config;
    });

    // Add disabled channels
    const allChannels: ('telegram' | 'discord' | 'web')[] = ['telegram', 'discord', 'web'];
    for (const channel of allChannels) {
      if (!answers.channels.includes(channel)) {
        channelConfigs.push({ type: channel, enabled: false });
      }
    }

    // Build final config
    return {
      version: '1.0.0',
      model: modelConfig,
      channels: channelConfigs,
      agent: {
        name: answers.agentName,
        personality: 'Assistante curieuse et directe',
        language: answers.language,
        skills: ['web.search', 'files.read'],
        rules: [
          'Ne jamais partager mes clés API',
          'Demander confirmation avant de supprimer',
        ],
      },
      created: Date.now(),
      updated: Date.now(),
    };
  }

  /**
   * Get default model for provider
   */
  private getDefaultModel(provider: string): string {
    const defaults: Record<string, string> = {
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      ollama: 'llama3.1',
    };
    return defaults[provider] || 'claude-sonnet-4-20250514';
  }
}

// ============================================================================
// Exports
// ============================================================================

export const wizard = new OnboardingWizard();

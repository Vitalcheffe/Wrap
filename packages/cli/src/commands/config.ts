/**
 * WRAP NEBULA CLI - Config Command
 * Manage NEBULA configuration
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigManager, NebulaConfig } from '../config.js';
import { spawn } from 'child_process';

export interface ConfigOptions {
  edit?: boolean;
  model?: string;
  channel?: string;
  reset?: boolean;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  const configManager = new ConfigManager();

  // Handle reset
  if (options.reset) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Supprimer toute la configuration ?',
        default: false,
      },
    ]);

    if (confirm) {
      configManager.delete();
      console.log(chalk.green('  ✓ Configuration supprimée.'));
      console.log(chalk.gray('    Lance ') + chalk.cyan('nebula init') + chalk.gray(' pour recommencer.'));
    }
    return;
  }

  // Handle edit
  if (options.edit) {
    const configPath = configManager.getConfigPath();
    const soulPath = configManager.getSoulPath();

    const { file } = await inquirer.prompt<{ file: 'config' | 'soul' }>([
      {
        type: 'list',
        name: 'file',
        message: 'Quel fichier éditer ?',
        choices: [
          { name: 'config.yaml - Configuration principale', value: 'config' },
          { name: 'SOUL.md - Personnalité de l\'agent', value: 'soul' },
        ],
      },
    ]);

    const filePath = file === 'config' ? configPath : soulPath;
    
    // Open in default editor
    const editor = process.env.EDITOR || process.env.VISUAL || 'nano';
    const child = spawn(editor, [filePath], { stdio: 'inherit' });
    
    child.on('exit', () => {
      console.log(chalk.green('  ✓ Fichier modifié.'));
    });
    
    return;
  }

  // Handle model change
  if (options.model) {
    const config = configManager.load();
    if (!config) {
      console.log(chalk.red('  ✗ Configuration non trouvée.'));
      return;
    }

    const [provider, model] = options.model.split('/');
    if (!provider || !model) {
      console.log(chalk.red('  ✗ Format invalide. Utilise: provider/model'));
      console.log(chalk.gray('    Ex: anthropic/claude-sonnet-4-20250514'));
      return;
    }

    config.model.provider = provider as 'anthropic' | 'openai' | 'ollama';
    config.model.model = model;
    configManager.save(config);

    console.log(chalk.green('  ✓ Modèle mis à jour: ') + chalk.white(options.model));
    return;
  }

  // Handle channel enable/disable
  if (options.channel) {
    const config = configManager.load();
    if (!config) {
      console.log(chalk.red('  ✗ Configuration non trouvée.'));
      return;
    }

    const [action, channelType] = options.channel.split(':');
    if (!action || !channelType) {
      console.log(chalk.red('  ✗ Format invalide. Utilise: enable:telegram ou disable:telegram'));
      return;
    }

    const channel = config.channels.find(c => c.type === channelType);
    if (!channel) {
      console.log(chalk.red('  ✗ Canal non trouvé: ') + chalk.white(channelType));
      return;
    }

    channel.enabled = action === 'enable';
    configManager.save(config);

    console.log(chalk.green(`  ✓ Canal ${channelType} ${action === 'enable' ? 'activé' : 'désactivé'}.`));
    return;
  }

  // Default: show interactive config menu
  await interactiveConfig(configManager);
}

async function interactiveConfig(configManager: ConfigManager): Promise<void> {
  const config = configManager.load();
  if (!config) {
    console.log(chalk.yellow('  ⚠ Configuration non trouvée.'));
    console.log(chalk.gray('    Lance ') + chalk.cyan('nebula init') + chalk.gray(' pour commencer.'));
    return;
  }

  console.log();
  console.log(chalk.cyan('  ⚙️  Configuration'));
  console.log();

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'Que veux-tu modifier ?',
      choices: [
        { name: '📦 Modèle', value: 'model' },
        { name: '💬 Canaux', value: 'channels' },
        { name: '🤖 Agent', value: 'agent' },
        { name: '📝 Éditer SOUL.md', value: 'soul' },
        { name: '🔄 Réinitialiser', value: 'reset' },
        new inquirer.Separator(),
        { name: '← Quitter', value: 'quit' },
      ],
    },
  ]);

  switch (action) {
    case 'model':
      await configureModel(configManager, config);
      break;
    case 'channels':
      await configureChannels(configManager, config);
      break;
    case 'agent':
      await configureAgent(configManager, config);
      break;
    case 'soul':
      // Open SOUL.md in editor
      const editor = process.env.EDITOR || 'nano';
      spawn(editor, [configManager.getSoulPath()], { stdio: 'inherit' });
      break;
    case 'reset':
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Réinitialiser la configuration ?',
          default: false,
        },
      ]);
      if (confirm) {
        configManager.delete();
        console.log(chalk.green('  ✓ Configuration réinitialisée.'));
      }
      break;
  }
}

async function configureModel(configManager: ConfigManager, config: NebulaConfig): Promise<void> {
  const { provider, model, apiKey } = await inquirer.prompt<{
    provider: string;
    model: string;
    apiKey?: string;
  }>([
    {
      type: 'list',
      name: 'provider',
      message: 'Provider',
      choices: [
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
        { name: 'Ollama (Local)', value: 'ollama' },
      ],
      default: config.model.provider,
    },
    {
      type: 'input',
      name: 'model',
      message: 'Modèle',
      default: config.model.model,
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Clé API (laisser vide pour garder)',
      mask: '*',
    },
  ]);

  config.model.provider = provider as 'anthropic' | 'openai' | 'ollama';
  config.model.model = model;
  if (apiKey && apiKey.trim()) {
    config.model.apiKey = apiKey;
  }

  configManager.save(config);
  console.log(chalk.green('  ✓ Modèle configuré.'));
}

async function configureChannels(configManager: ConfigManager, config: NebulaConfig): Promise<void> {
  const { channels } = await inquirer.prompt<{
    channels: ('telegram' | 'discord' | 'web')[];
  }>([
    {
      type: 'checkbox',
      name: 'channels',
      message: 'Canaux actifs',
      choices: [
        { name: 'Telegram', value: 'telegram', checked: config.channels.find(c => c.type === 'telegram')?.enabled },
        { name: 'Discord', value: 'discord', checked: config.channels.find(c => c.type === 'discord')?.enabled },
        { name: 'Web', value: 'web', checked: config.channels.find(c => c.type === 'web')?.enabled },
      ],
    },
  ]);

  for (const channel of config.channels) {
    channel.enabled = channels.includes(channel.type as 'telegram' | 'discord' | 'web');
  }

  configManager.save(config);
  console.log(chalk.green('  ✓ Canaux configurés.'));
}

async function configureAgent(configManager: ConfigManager, config: NebulaConfig): Promise<void> {
  const { name, language, personality } = await inquirer.prompt<{
    name: string;
    language: string;
    personality: string;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Nom de l\'agent',
      default: config.agent.name,
    },
    {
      type: 'list',
      name: 'language',
      message: 'Langue',
      choices: ['Français', 'English', 'Español', 'Deutsch'],
      default: config.agent.language,
    },
    {
      type: 'input',
      name: 'personality',
      message: 'Personnalité',
      default: config.agent.personality,
    },
  ]);

  config.agent.name = name;
  config.agent.language = language;
  config.agent.personality = personality;

  configManager.save(config);
  console.log(chalk.green('  ✓ Agent configuré.'));
}

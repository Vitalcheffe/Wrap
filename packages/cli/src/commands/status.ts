/**
 * WRAP NEBULA CLI - Status Command
 * Display NEBULA agent status
 */

import chalk from 'chalk';
import { ConfigManager } from '../config.js';

export async function statusCommand(): Promise<void> {
  const configManager = new ConfigManager();

  console.log();
  console.log(chalk.cyan('  🌌 NEBULA Status'));
  console.log();

  // Check if config exists
  if (!configManager.exists()) {
    console.log(chalk.yellow('  ⚠ Configuration non trouvée.'));
    console.log(chalk.gray('    Lance ') + chalk.cyan('nebula init') + chalk.gray(' pour commencer.'));
    console.log();
    return;
  }

  const config = configManager.load();
  if (!config) {
    console.log(chalk.red('  ✗ Erreur lors du chargement de la configuration.'));
    return;
  }

  // Display status
  console.log(chalk.white('  Configuration:'));
  console.log();
  
  // Model
  console.log(chalk.gray('  📦 Modèle'));
  console.log(chalk.gray('    Provider: ') + chalk.white(config.model.provider));
  console.log(chalk.gray('    Model: ') + chalk.white(config.model.model));
  console.log(chalk.gray('    API Key: ') + chalk.white(config.model.apiKey ? '••••••••' + config.model.apiKey.slice(-4) : 'non configurée'));
  console.log();

  // Channels
  console.log(chalk.gray('  💬 Canaux'));
  for (const channel of config.channels) {
    const status = channel.enabled 
      ? chalk.green('✓') 
      : chalk.red('✗');
    console.log(chalk.gray('    ') + status + ' ' + chalk.white(channel.type));
  }
  console.log();

  // Agent
  console.log(chalk.gray('  🤖 Agent'));
  console.log(chalk.gray('    Nom: ') + chalk.white(config.agent.name));
  console.log(chalk.gray('    Langue: ') + chalk.white(config.agent.language));
  console.log(chalk.gray('    Skills: ') + chalk.white(config.agent.skills.join(', ')));
  console.log();

  // Files
  console.log(chalk.gray('  📁 Fichiers'));
  console.log(chalk.gray('    Config: ') + chalk.white(configManager.getConfigPath()));
  console.log(chalk.gray('    SOUL.md: ') + chalk.white(configManager.getSoulPath()));
  console.log();

  // Timestamps
  const created = new Date(config.created).toLocaleString('fr-FR');
  const updated = new Date(config.updated).toLocaleString('fr-FR');
  console.log(chalk.gray('  ⏰ Créé: ') + chalk.white(created));
  console.log(chalk.gray('     Modifié: ') + chalk.white(updated));
  console.log();
}

/**
 * WRAP NEBULA CLI - Start Command
 * Start the NEBULA agent
 */

import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../config.js';

export interface StartOptions {
  channel?: string;
  debug?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const configManager = new ConfigManager();

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

  console.log();
  console.log(chalk.cyan('  🌌 Démarrage de NEBULA...'));
  console.log();

  // Display config summary
  console.log(chalk.gray('  Configuration:'));
  console.log(chalk.gray('    • Modèle: ') + chalk.white(`${config.model.provider}/${config.model.model}`));
  console.log(chalk.gray('    • Agent: ') + chalk.white(config.agent.name));
  
  const enabledChannels = config.channels.filter(c => c.enabled);
  if (enabledChannels.length > 0) {
    console.log(chalk.gray('    • Canaux: ') + chalk.white(enabledChannels.map(c => c.type).join(', ')));
  }
  console.log();

  const spinner = ora(chalk.gray('Initialisation de l\'agent...')).start();

  try {
    // TODO: Actually start the agent runtime
    // For now, simulate startup
    await new Promise(resolve => setTimeout(resolve, 1500));

    spinner.succeed(chalk.green('Agent initialisé !'));

    console.log();
    console.log(chalk.cyan('  🚀 NEBULA est en cours d\'exécution.'));
    console.log();
    
    // Channel-specific messages
    for (const channel of enabledChannels) {
      if (channel.type === 'telegram') {
        console.log(chalk.gray('    Telegram: ') + chalk.white('Recherche ton bot et envoie /start'));
      } else if (channel.type === 'discord') {
        console.log(chalk.gray('    Discord: ') + chalk.white('Le bot devrait être en ligne'));
      } else if (channel.type === 'web') {
        console.log(chalk.gray('    Web: ') + chalk.white('Ouvre http://localhost:3000'));
      }
    }
    console.log();
    console.log(chalk.gray('  Appuie sur ') + chalk.white('Ctrl+C') + chalk.gray(' pour arrêter.'));
    console.log();

    // Keep running
    if (options.debug) {
      console.log(chalk.yellow('  Mode debug activé.'));
      console.log();
    }

    // Wait indefinitely (or until signal)
    await new Promise(() => {});

  } catch (error) {
    spinner.fail(chalk.red('Erreur lors du démarrage.'));
    console.error(chalk.red(`  ${(error as Error).message}`));
  }
}

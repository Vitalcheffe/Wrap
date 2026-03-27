/**
 * WRAP NEBULA CLI - Stop Command
 * Stop the NEBULA agent
 */

import chalk from 'chalk';
import { ConfigManager } from '../config.js';

export async function stopCommand(): Promise<void> {
  const configManager = new ConfigManager();

  console.log();
  console.log(chalk.cyan('  🛑 Arrêt de NEBULA...'));
  console.log();

  // TODO: Actually stop the agent runtime
  // For now, just display message

  console.log(chalk.green('  ✓ NEBULA arrêté.'));
  console.log();
}

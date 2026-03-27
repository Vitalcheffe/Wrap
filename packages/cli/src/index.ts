#!/usr/bin/env node
/**
 * WRAP NEBULA CLI v1.0.0
 * Interactive onboarding wizard for beginners
 * 
 * Usage:
 *   nebula init     - Launch interactive setup wizard
 *   nebula start    - Start the agent
 *   nebula stop     - Stop the agent
 *   nebula status   - Show agent status
 *   nebula config   - Manage configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { OnboardingWizard } from './wizard.js';
import { startCommand, stopCommand, statusCommand, configCommand } from './commands/index.js';
import { ConfigManager } from './config.js';

// ============================================================================
// Program Setup
// ============================================================================

const program = new Command();

program
  .name('nebula')
  .description('🌌 WRAP NEBULA - Zero Trust AI Agent Framework')
  .version('1.0.0');

// ============================================================================
// Commands
// ============================================================================

// Init command - Interactive wizard
program
  .command('init')
  .description('Launch interactive setup wizard')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(async (options: { force?: boolean }) => {
    const configManager = new ConfigManager();

    // Check if config already exists
    if (configManager.exists() && !options.force) {
      console.log();
      console.log(chalk.yellow('  ⚠ Configuration déjà existante.'));
      console.log(chalk.gray('    Utilise ') + chalk.cyan('--force') + chalk.gray(' pour écraser.'));
      console.log();
      return;
    }

    // Run wizard
    const wizard = new OnboardingWizard();
    await wizard.run();
  });

// Start command - Start agent
program
  .command('start')
  .description('Start the NEBULA agent')
  .option('-c, --channel <channel>', 'Start specific channel only')
  .option('-d, --debug', 'Enable debug mode')
  .action(async (options: { channel?: string; debug?: boolean }) => {
    await startCommand(options);
  });

// Stop command - Stop agent
program
  .command('stop')
  .description('Stop the NEBULA agent')
  .action(async () => {
    await stopCommand();
  });

// Status command - Show status
program
  .command('status')
  .description('Show NEBULA agent status')
  .action(async () => {
    await statusCommand();
  });

// Config command - Manage config
program
  .command('config')
  .description('Manage NEBULA configuration')
  .option('-e, --edit', 'Open config in editor')
  .option('-m, --model <model>', 'Set model (provider/model)')
  .option('-c, --channel <action>', 'Enable/disable channel (enable:telegram)')
  .option('-r, --reset', 'Reset configuration')
  .action(async (options: { edit?: boolean; model?: string; channel?: string; reset?: boolean }) => {
    await configCommand(options);
  });

// Doctor command - Diagnose issues
program
  .command('doctor')
  .description('Diagnose NEBULA installation')
  .action(async () => {
    console.log();
    console.log(chalk.cyan('  🩺 NEBULA Doctor'));
    console.log();

    const configManager = new ConfigManager();
    let allGood = true;

    // Check config
    if (configManager.exists()) {
      console.log(chalk.green('  ✓') + chalk.gray(' Configuration trouvée'));
      
      const config = configManager.load();
      if (config) {
        // Check API key
        if (config.model.apiKey || config.model.provider === 'ollama') {
          console.log(chalk.green('  ✓') + chalk.gray(' Clé API configurée'));
        } else {
          console.log(chalk.yellow('  ⚠') + chalk.gray(' Clé API non configurée'));
          allGood = false;
        }

        // Check channels
        const enabledChannels = config.channels.filter(c => c.enabled);
        if (enabledChannels.length > 0) {
          console.log(chalk.green('  ✓') + chalk.gray(` ${enabledChannels.length} canal(aux) activé(s)`));
        } else {
          console.log(chalk.yellow('  ⚠') + chalk.gray(' Aucun canal activé'));
          allGood = false;
        }
      }
    } else {
      console.log(chalk.yellow('  ⚠') + chalk.gray(' Configuration non trouvée'));
      console.log(chalk.gray('    Lance ') + chalk.cyan('nebula init') + chalk.gray(' pour commencer.'));
      allGood = false;
    }

    // Check SOUL.md
    if (configManager.soulExists()) {
      console.log(chalk.green('  ✓') + chalk.gray(' SOUL.md trouvé'));
    } else {
      console.log(chalk.gray('  ℹ SOUL.md non trouvé (optionnel)'));
    }

    console.log();
    if (allGood) {
      console.log(chalk.green('  ✓ Tout semble correct !'));
      console.log(chalk.gray('    Lance ') + chalk.cyan('nebula start') + chalk.gray(' pour démarrer.'));
    } else {
      console.log(chalk.yellow('  ⚠ Certains problèmes détectés.'));
      console.log(chalk.gray('    Lance ') + chalk.cyan('nebula init') + chalk.gray(' ou ') + chalk.cyan('nebula config') + chalk.gray(' pour corriger.'));
    }
    console.log();
  });

// ============================================================================
// Error Handling
// ============================================================================

program.exitOverride();

process.on('uncaughtException', (error) => {
  console.error(chalk.red('  ✗ Erreur inattendue:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('  ✗ Erreur:'), reason);
  process.exit(1);
});

// ============================================================================
// Run
// ============================================================================

program.parse();

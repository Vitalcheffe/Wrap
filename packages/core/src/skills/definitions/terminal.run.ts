/**
 * WRAP CODE — Terminal Run Skill
 * Sandboxed shell command execution
 */

import { execSync } from 'child_process';
import { SkillDefinition } from '../index';

const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  'fork()',
  ':(){:|:&};:',
  'chmod 777',
  'chown root',
  '> /dev/sda',
  'wget',
  'curl -X POST',
  'nc -e',
  'bash -i',
  'python -c "import socket',
  'perl -e "use Socket"',
];

function isDangerous(cmd: string): boolean {
  const lower = cmd.toLowerCase().trim();
  for (const blocked of BLOCKED_COMMANDS) {
    if (lower.includes(blocked.toLowerCase())) {
      return true;
    }
  }
  // Block attempts to read sensitive files
  const sensitivePatterns = ['/etc/shadow', '/etc/passwd', '.ssh/id_rsa', '.env'];
  for (const pattern of sensitivePatterns) {
    if (lower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

export const terminalRunSkill: SkillDefinition = {
  name: 'terminal.run',
  description: 'Run a shell command in a sandboxed environment. Dangerous commands are blocked. 30 second timeout.',
  parameters: {
    command: { type: 'string', description: 'Shell command to execute', required: true },
    cwd: { type: 'string', description: 'Working directory (default: ~/wrap-files)', required: false },
    timeout: { type: 'number', description: 'Timeout in ms (default: 30000, max: 60000)', required: false },
  },
  async execute(params: Record<string, unknown>) {
    const command = params.command as string;
    const cwd = (params.cwd as string) || process.env.WRAP_FILES_DIR || `${process.env.HOME}/wrap-files`;
    const timeout = Math.min((params.timeout as number) || 30000, 60000);

    if (isDangerous(command)) {
      return {
        success: false,
        output: `⛔ Command blocked: this command is potentially dangerous and cannot be executed.\nCommand: ${command}`,
      };
    }

    try {
      const stdout = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PATH: process.env.PATH,
          HOME: cwd,
        },
      });

      const trimmed = stdout.trim();
      if (!trimmed) {
        return { success: true, output: `Exit 0\n\n(command completed with no output)` };
      }

      return { success: true, output: `Exit 0\n\n${trimmed}` };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; status?: number; message?: string };
      if (err.message?.includes('ETIMEDOUT') || err.message?.includes('timed out')) {
        return {
          success: false,
          output: `⏱️ Execution timed out after ${timeout / 1000} seconds.\nCommand: ${command}`,
        };
      }

      const stdout = err.stdout?.trim() || '';
      const stderr = err.stderr?.trim() || '';
      const exitCode = err.status || 1;

      let output = `Exit ${exitCode}\n`;
      if (stdout) output += `\nStdout: ${stdout}`;
      if (stderr) output += `\nStderr: ${stderr}`;

      return { success: false, output };
    }
  },
};

/**
 * WRAP CODE — Terminal Run Skill
 */

import { execSync } from 'child_process';
import { SkillDefinition, SkillContext, SkillResult } from '../index.js';

const BLOCKED = ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:', 'chmod 777', '/etc/shadow', '/etc/passwd'];

export const terminalRunSkill: SkillDefinition = {
  name: 'terminal.run',
  description: 'Run a shell command in a sandboxed environment. Dangerous commands are blocked.',
  category: 'system',
  permissions: ['exec'],
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
    },
    required: ['command'],
  },
  required: ['command'],
  examples: [
    { description: 'List files', params: { command: 'ls -la' }, result: 'Directory listing' },
  ],
  handler: async (params: Record<string, unknown>): Promise<SkillResult> => {
    const command = params.command as string;
    const cwd = (params.cwd as string) || process.env.WRAP_FILES_DIR || `${process.env.HOME}/wrap-files`;
    if (BLOCKED.some(b => command.toLowerCase().includes(b.toLowerCase()))) {
      return { success: false, output: null, error: `⛔ Command blocked: ${command}` };
    }
    try {
      const stdout = execSync(command, { cwd, encoding: 'utf-8', timeout: 30000, maxBuffer: 1024 * 1024 });
      return { success: true, output: stdout.trim() || '(no output)' };
    } catch (e: unknown) {
      const err = e as { stderr?: string; status?: number; message?: string };
      return { success: false, output: null, error: err.stderr?.trim() || err.message || 'Command failed' };
    }
  },
};

/**
 * WRAP NEBULA Core - Git Status Skill
 * Get Git repository status
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import { spawn } from 'child_process';

export const gitStatusSkill: SkillDefinition = {
  name: 'git.status',
  description: 'Get the status of a Git repository',
  category: 'development',
  permissions: ['git:read'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the Git repository (default: current directory)',
      },
      porcelain: {
        type: 'boolean',
        description: 'Use machine-readable format',
      },
    },
  },
  examples: [
    {
      description: 'Get repository status',
      params: {},
      result: { branch: 'main', ahead: 2, behind: 0, modified: ['file.ts'] },
    },
  ],
  handler: async (params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> => {
    const repoPath = (params.path as string) || process.cwd();
    const porcelain = (params.porcelain as boolean) ?? false;

    try {
      // Get branch name
      const branch = await runGit(repoPath, ['branch', '--show-current']);

      // Get ahead/behind count
      const upstream = await runGit(repoPath, ['rev-parse', '--abbrev-ref', '@{upstream}']).catch(() => null);
      let ahead = 0;
      let behind = 0;

      if (upstream) {
        const counts = await runGit(repoPath, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
        const [behindCount, aheadCount] = counts.split('\t').map(Number);
        ahead = aheadCount || 0;
        behind = behindCount || 0;
      }

      // Get status
      const status = await runGit(repoPath, ['status', '--porcelain']);
      const changes = parseStatus(status);

      return {
        success: true,
        output: {
          path: repoPath,
          branch: branch.trim(),
          upstream: upstream?.trim() || null,
          ahead,
          behind,
          clean: changes.length === 0,
          changes,
          summary: {
            modified: changes.filter(c => c.status === 'modified').length,
            added: changes.filter(c => c.status === 'added').length,
            deleted: changes.filter(c => c.status === 'deleted').length,
            untracked: changes.filter(c => c.status === 'untracked').length,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Git status failed: ${(error as Error).message}`,
      };
    }
  },
};

interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'unknown';
  staged: boolean;
}

function parseStatus(status: string): FileChange[] {
  const lines = status.split('\n').filter(Boolean);
  const changes: FileChange[] = [];

  for (const line of lines) {
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePath = line.substring(3);

    let status: FileChange['status'] = 'unknown';
    const staged = indexStatus !== ' ' && indexStatus !== '?';

    if (indexStatus === 'A' || workTreeStatus === 'A') {
      status = 'added';
    } else if (indexStatus === 'D' || workTreeStatus === 'D') {
      status = 'deleted';
    } else if (indexStatus === 'R' || workTreeStatus === 'R') {
      status = 'renamed';
    } else if (indexStatus === '?' && workTreeStatus === '?') {
      status = 'untracked';
    } else if (indexStatus === 'M' || workTreeStatus === 'M') {
      status = 'modified';
    }

    changes.push({ path: filePath, status, staged });
  }

  return changes;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Git exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

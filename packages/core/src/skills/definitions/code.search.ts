/**
 * WRAP CODE — Code Search Skill
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { SkillDefinition, SkillContext, SkillResult } from '../index.js';

function getFilesDir(): string {
  return process.env.WRAP_FILES_DIR || path.join(process.env.HOME || '/root', 'wrap-files');
}

export const codeSearchSkill: SkillDefinition = {
  name: 'code.search',
  description: 'Search the codebase for patterns. Supports grep (regex), find (filename), and symbol search.',
  category: 'code',
  permissions: ['fs:read'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search pattern' },
      mode: { type: 'string', description: 'grep (default), find, or symbol' },
      directory: { type: 'string', description: 'Directory to search in' },
    },
    required: ['query'],
  },
  required: ['query'],
  examples: [
    { description: 'Find all TypeScript files', params: { query: '*.ts', mode: 'find' }, result: 'List of files' },
  ],
  handler: async (params: Record<string, unknown>): Promise<SkillResult> => {
    const query = params.query as string;
    const mode = (params.mode as string) || 'grep';
    const directory = (params.directory as string) || '.';
    const FILES_DIR = getFilesDir();
    const searchDir = path.resolve(FILES_DIR, directory);
    if (!searchDir.startsWith(FILES_DIR)) return { success: false, output: null, error: 'Access denied' };

    try {
      if (mode === 'find') {
        const regex = new RegExp(query.replace(/\*/g, '.*'), 'i');
        const walk = (d: string): string[] => {
          const r: string[] = [];
          try { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            const fp = path.join(d, e.name);
            if (e.isDirectory()) r.push(...walk(fp)); else r.push(fp);
          }} catch { /* skip */ }
          return r;
        };
        const matches = walk(searchDir).filter(f => regex.test(path.basename(f))).map(f => path.relative(FILES_DIR, f)).slice(0, 50);
        return { success: true, output: matches.length ? matches.join('\n') : 'No matches found.' };
      }
      const output = execSync(`grep -rn -C 2 --color=never '${query}' '${searchDir}'`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 1024 });
      return { success: true, output: output.split('\n').slice(0, 100).join('\n') };
    } catch (e: unknown) {
      const err = e as { stdout?: string };
      return { success: true, output: err.stdout || `No matches for "${query}".` };
    }
  },
};

/**
 * WRAP CODE — Project Context Skill
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition, SkillContext, SkillResult } from '../index.js';

function getFilesDir(): string {
  return process.env.WRAP_FILES_DIR || path.join(process.env.HOME || '/root', 'wrap-files');
}

const IGNORE = ['node_modules', '.git', '.next', 'dist', 'build', 'target'];

export const projectContextSkill: SkillDefinition = {
  name: 'project.context',
  description: 'Analyze a project and return relevant files for understanding a codebase.',
  category: 'code',
  permissions: ['fs:read'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      projectRoot: { type: 'string', description: 'Project root directory' },
      query: { type: 'string', description: 'What you are looking for' },
      maxFiles: { type: 'number', description: 'Max files to return (default 5)' },
    },
  },
  examples: [
    { description: 'Get project overview', params: { projectRoot: '.', maxFiles: 5 }, result: 'Top 5 relevant files' },
  ],
  handler: async (params: Record<string, unknown>): Promise<SkillResult> => {
    const projectRoot = (params.projectRoot as string) || '.';
    const query = (params.query as string) || '';
    const maxFiles = (params.maxFiles as number) || 5;
    const FILES_DIR = getFilesDir();
    const rootPath = path.resolve(FILES_DIR, projectRoot);
    if (!rootPath.startsWith(FILES_DIR)) return { success: false, output: null, error: 'Access denied' };

    const walk = (d: string, depth = 0): string[] => {
      if (depth > 8) return [];
      const r: string[] = [];
      try { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (IGNORE.includes(e.name) || e.name.startsWith('.')) continue;
        const fp = path.join(d, e.name);
        if (e.isDirectory()) r.push(...walk(fp, depth + 1)); else r.push(fp);
      }} catch { /* skip */ }
      return r;
    };

    const allFiles = walk(rootPath);
    const scored = allFiles.map(f => ({
      path: f,
      score: (query && path.basename(f).toLowerCase().includes(query.toLowerCase()) ? 10 : 0) + (f.endsWith('.ts') ? 3 : 1),
    })).sort((a, b) => b.score - a.score).slice(0, maxFiles);

    const results = scored.map(({ path: fp }) => {
      const rel = path.relative(FILES_DIR, fp);
      try { return `### ${rel}\n${fs.readFileSync(fp, 'utf-8').split('\n').slice(0, 150).join('\n')}`; }
      catch { return `### ${rel}\n(binary)`; }
    });

    return { success: true, output: `Project: ${projectRoot} (${allFiles.length} files)\n\n${results.join('\n\n')}` };
  },
};

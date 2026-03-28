/**
 * WRAP CODE — Project Context Skill
 * Smart file inclusion for LLM context window
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition } from '../index';

function getFilesDir(): string { return process.env.WRAP_FILES_DIR || path.join(process.env.HOME || '/root', 'wrap-files'); }
const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', 'target', '__pycache__', '.cache'];
const IGNORE_FILES = ['.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

function walkDir(dir: string, maxDepth: number = 8, depth: number = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name) || IGNORE_FILES.includes(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath, maxDepth, depth + 1));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}

function scoreFile(filePath: string, query: string): number {
  const basename = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).slice(1);
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);
  let score = 0;

  // Filename match
  for (const word of queryWords) {
    if (basename.includes(word)) score += 10;
  }

  // Extension preference for code
  const codeExts: Record<string, number> = {
    ts: 3, js: 3, py: 3, rs: 3, go: 3, java: 3,
    tsx: 2, jsx: 2, md: 1, json: 1, yaml: 1,
  };
  score += codeExts[ext] || 0;

  // Config files get lower priority
  const configFiles = ['package.json', 'tsconfig.json', 'Cargo.toml', 'Makefile'];
  if (configFiles.includes(basename)) score -= 2;

  return score;
}

export const projectContextSkill: SkillDefinition = {
  name: 'project.context',
  description: 'Analyze a project and return relevant files for understanding a codebase. Smart file scoring based on query relevance.',
  parameters: {
    projectRoot: { type: 'string', description: 'Project root directory (relative to ~/wrap-files/)', required: false },
    query: { type: 'string', description: 'What you are looking for (e.g., "authentication", "database schema", "API routes")', required: false },
    maxFiles: { type: 'number', description: 'Maximum number of files to return (default: 5)', required: false },
    maxLinesPerFile: { type: 'number', description: 'Maximum lines to include per file (default: 200)', required: false },
  },
  async execute(params: Record<string, unknown>) {
    const projectRoot = (params.projectRoot as string) || '.';
    const query = (params.query as string) || '';
    const maxFiles = (params.maxFiles as number) || 5;
    const maxLines = (params.maxLinesPerFile as number) || 200;

    const rootPath = path.resolve(getFilesDir(), projectRoot);
    if (!rootPath.startsWith(getFilesDir())) {
      return { success: false, output: 'Access denied: path is outside the allowed directory' };
    }

    if (!fs.existsSync(rootPath)) {
      return { success: false, output: `Project not found: ${projectRoot}` };
    }

    // List all files
    const allFiles = walkDir(rootPath);

    // Score and sort
    const scored = allFiles
      .map(f => ({ path: f, score: scoreFile(f, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFiles);

    if (scored.length === 0) {
      return { success: true, output: 'No files found in the project directory.' };
    }

    // Read top files
    const results: string[] = [];
    for (const { path: filePath } of scored) {
      const relPath = path.relative(getFilesDir(), filePath);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').slice(0, maxLines);
        const truncated = content.split('\n').length > maxLines ? '\n... (truncated)' : '';
        results.push(`### ${relPath}\n\`\`\`\n${lines.join('\n')}${truncated}\n\`\`\``);
      } catch {
        results.push(`### ${relPath}\n(binary or unreadable file)`);
      }
    }

    const output = [
      `Project context for: ${projectRoot}`,
      `Files analyzed: ${allFiles.length}`,
      `Most relevant ${scored.length} file(s)${query ? ` for "${query}"` : ''}:\n`,
      results.join('\n\n'),
    ].join('\n');

    return { success: true, output, raw: { totalFiles: allFiles.length, shownFiles: scored.length } };
  },
};

/**
 * WRAP CODE — Code Search Skill
 * Grep, find, and symbol search across codebases
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { SkillDefinition } from '../index';

function getFilesDir(): string { return process.env.WRAP_FILES_DIR || path.join(process.env.HOME || '/root', 'wrap-files'); }

function validatePath(filePath: string): boolean {
  const resolved = path.resolve(getFilesDir(), filePath);
  return resolved.startsWith(getFilesDir()) && !filePath.includes('..');
}

function walkDir(dir: string, maxDepth: number = 10, depth: number = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
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

export const codeSearchSkill: SkillDefinition = {
  name: 'code.search',
  description: 'Search the codebase for patterns. Supports grep (regex), find (filename), and symbol search.',
  parameters: {
    query: { type: 'string', description: 'Search pattern (regex for grep mode, glob for find mode)', required: true },
    mode: { type: 'string', description: 'Search mode: grep (default), find, or symbol', required: false },
    directory: { type: 'string', description: 'Directory to search in (relative to ~/wrap-files/)', required: false },
    fileTypes: { type: 'string', description: 'Comma-separated file extensions to search (e.g., "ts,js,py")', required: false },
    contextLines: { type: 'number', description: 'Number of context lines to show (default: 2)', required: false },
  },
  async execute(params: Record<string, unknown>) {
    const query = params.query as string;
    const mode = (params.mode as string) || 'grep';
    const directory = (params.directory as string) || '.';
    const fileTypes = (params.fileTypes as string) || '';
    const contextLines = (params.contextLines as number) || 2;

    if (!validatePath(directory)) {
      return { success: false, output: 'Access denied: directory is outside the allowed path' };
    }

    const searchDir = path.resolve(getFilesDir(), directory);
    if (!fs.existsSync(searchDir)) {
      return { success: false, output: `Directory not found: ${directory}` };
    }

    const maxResults = 50;
    const timeout = 10000;

    try {
      if (mode === 'find') {
        // Find files by name pattern
        const allFiles = walkDir(searchDir);
        const regex = new RegExp(query.replace(/\*/g, '.*'), 'i');
        const matches = allFiles
          .filter(f => regex.test(path.basename(f)))
          .map(f => path.relative(getFilesDir(), f))
          .slice(0, maxResults);

        if (matches.length === 0) {
          return { success: true, output: `No files matching "${query}" found.` };
        }

        return {
          success: true,
          output: `Found ${matches.length} file(s):\n${matches.map(m => `  ${m}`).join('\n')}`,
        };
      } else if (mode === 'symbol') {
        // Symbol search (function/class/const declarations)
        const allFiles = walkDir(searchDir);
        const exts = fileTypes ? fileTypes.split(',') : ['ts', 'js', 'py', 'rs'];
        const filtered = allFiles.filter(f => exts.some(e => f.endsWith(`.${e}`)));

        const results: string[] = [];
        const symbolPatterns = [
          `(function|class|const|let|var|export|def|pub fn|pub struct|pub enum)\\s+${query}`,
          `(${query})\\s*[=({:]`,
        ];
        const regex = new RegExp(symbolPatterns.join('|'), 'gi');

        for (const file of filtered) {
          if (results.length >= maxResults) break;
          const content = fs.readFileSync(file, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (regex.test(lines[i])) {
              const relPath = path.relative(getFilesDir(), file);
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
            }
          }
        }

        if (results.length === 0) {
          return { success: true, output: `No symbols matching "${query}" found.` };
        }

        return {
          success: true,
          output: `Found ${results.length} symbol(s):\n${results.join('\n')}`,
        };
      } else {
        // Grep mode (default)
        const grepArgs = [
          '-rn',
          '--include=*.{ts,js,py,rs,tsx,jsx,md,json,yaml,yml,toml}',
          '-C', String(contextLines),
          '--color=never',
          query,
          searchDir,
        ];

        let output: string;
        try {
          output = execSync(`grep ${grepArgs.map(a => `'${a}'`).join(' ')}`, {
            encoding: 'utf-8',
            timeout,
            maxBuffer: 1024 * 1024,
          });
        } catch (e: unknown) {
          const err = e as { stdout?: string; status?: number };
          if (err.stdout) {
            output = err.stdout;
          } else {
            return { success: true, output: `No matches found for "${query}".` };
          }
        }

        const lines = output.split('\n').filter(Boolean).slice(0, maxResults * 5);
        const matchCount = lines.filter(l => /^\S+:\d+:/.test(l)).length;

        return {
          success: true,
          output: `Found ${matchCount} match(es):\n\n${lines.join('\n')}`,
        };
      }
    } catch (e: unknown) {
      const err = e as Error;
      return { success: false, output: `Search failed: ${err.message}` };
    }
  },
};

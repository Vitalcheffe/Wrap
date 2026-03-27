/**
 * WRAP NEBULA Core - Files List Skill
 * List directory contents
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import * as fs from 'fs';
import * as path from 'path';

export const filesListSkill: SkillDefinition = {
  name: 'files.list',
  description: 'List contents of a directory',
  category: 'files',
  permissions: ['fs:read'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the directory to list',
      },
      recursive: {
        type: 'boolean',
        description: 'List recursively',
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern to filter files',
      },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files (starting with .)',
      },
    },
    required: ['path'],
  },
  required: ['path'],
  examples: [
    {
      description: 'List files in a directory',
      params: { path: '/home/user/projects' },
      result: { entries: [{ name: 'file.txt', type: 'file', size: 1024 }] },
    },
  ],
  handler: async (params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> => {
    const dirPath = params.path as string;
    const recursive = (params.recursive as boolean) ?? false;
    const pattern = params.pattern as string | undefined;
    const includeHidden = (params.includeHidden as boolean) ?? false;

    try {
      // Check if directory exists
      if (!fs.existsSync(dirPath)) {
        return {
          success: false,
          output: null,
          error: `Directory not found: ${dirPath}`,
        };
      }

      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          output: null,
          error: `Not a directory: ${dirPath}`,
        };
      }

      // List entries
      const entries = listDirectory(dirPath, recursive, includeHidden, pattern);

      return {
        success: true,
        output: {
          path: dirPath,
          entries,
          total: entries.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Failed to list directory: ${(error as Error).message}`,
      };
    }
  },
};

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: number;
}

function listDirectory(
  dir: string,
  recursive: boolean,
  includeHidden: boolean,
  pattern?: string
): DirEntry[] {
  const entries: DirEntry[] = [];
  
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    // Skip hidden files unless requested
    if (!includeHidden && item.name.startsWith('.')) {
      continue;
    }

    // Apply pattern filter
    if (pattern && !matchPattern(item.name, pattern)) {
      continue;
    }

    const fullPath = path.join(dir, item.name);
    const stats = item.isSymbolicLink()
      ? fs.lstatSync(fullPath)
      : fs.statSync(fullPath);

    entries.push({
      name: item.name,
      path: fullPath,
      type: item.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modified: stats.mtimeMs,
    });

    // Recurse into subdirectories
    if (recursive && item.isDirectory() && !item.isSymbolicLink()) {
      entries.push(...listDirectory(fullPath, recursive, includeHidden, pattern));
    }
  }

  return entries;
}

function matchPattern(name: string, pattern: string): boolean {
  // Simple glob pattern matching
  const regex = new RegExp(
    '^' + pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$'
  );
  return regex.test(name);
}

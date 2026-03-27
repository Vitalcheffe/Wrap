/**
 * WRAP NEBULA Core - Files Write Skill
 * Create or modify files
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import * as fs from 'fs';
import * as path from 'path';

export const filesWriteSkill: SkillDefinition = {
  name: 'files.write',
  description: 'Create or modify a file on the filesystem',
  category: 'files',
  permissions: ['fs:write'],
  dangerous: true, // Has side effects
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      mode: {
        type: 'string',
        description: 'Write mode',
        enum: ['overwrite', 'append', 'prepend'],
      },
      createDirs: {
        type: 'boolean',
        description: 'Create parent directories if they don\'t exist',
      },
    },
    required: ['path', 'content'],
  },
  required: ['path', 'content'],
  examples: [
    {
      description: 'Write a new file',
      params: { path: '/home/user/newfile.txt', content: 'Hello World!' },
      result: { created: true, bytes: 12 },
    },
  ],
  handler: async (params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> => {
    const filePath = params.path as string;
    const content = params.content as string;
    const mode = (params.mode as string) || 'overwrite';
    const createDirs = (params.createDirs as boolean) ?? true;

    try {
      // Create directories if needed
      if (createDirs) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      // Write file based on mode
      let finalContent = content;
      let existed = fs.existsSync(filePath);

      if (mode === 'append' && existed) {
        const existing = fs.readFileSync(filePath, 'utf-8');
        finalContent = existing + content;
      } else if (mode === 'prepend' && existed) {
        const existing = fs.readFileSync(filePath, 'utf-8');
        finalContent = content + existing;
      }

      fs.writeFileSync(filePath, finalContent, 'utf-8');

      return {
        success: true,
        output: {
          path: filePath,
          mode,
          bytes: Buffer.byteLength(finalContent, 'utf-8'),
          created: !existed,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Failed to write file: ${(error as Error).message}`,
      };
    }
  },
};

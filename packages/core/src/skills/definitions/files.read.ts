/**
 * WRAP NEBULA Core - Files Read Skill
 * Read local files
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import * as fs from 'fs';
import * as path from 'path';

export const filesReadSkill: SkillDefinition = {
  name: 'files.read',
  description: 'Read the contents of a file from the filesystem',
  category: 'files',
  permissions: ['fs:read'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
        enum: ['utf-8', 'base64', 'binary'],
      },
      maxLines: {
        type: 'number',
        description: 'Maximum number of lines to read',
        minimum: 1,
        maximum: 10000,
      },
    },
    required: ['path'],
  },
  required: ['path'],
  examples: [
    {
      description: 'Read a text file',
      params: { path: '/home/user/document.txt' },
      result: { content: 'File contents...', lines: 42 },
    },
  ],
  handler: async (params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> => {
    const filePath = params.path as string;
    const encoding = (params.encoding as string) || 'utf-8';
    const maxLines = params.maxLines as number | undefined;

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          output: null,
          error: `File not found: ${filePath}`,
        };
      }

      // Read file
      const content = fs.readFileSync(filePath, encoding as BufferEncoding);
      
      // Apply max lines if specified
      let processedContent = content;
      let lines: number | undefined;
      
      if (maxLines && typeof content === 'string') {
        const contentLines = content.split('\n');
        lines = contentLines.length;
        processedContent = contentLines.slice(0, maxLines).join('\n');
      }

      return {
        success: true,
        output: {
          path: filePath,
          content: processedContent,
          lines,
          size: Buffer.byteLength(content, encoding as BufferEncoding),
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Failed to read file: ${(error as Error).message}`,
      };
    }
  },
};

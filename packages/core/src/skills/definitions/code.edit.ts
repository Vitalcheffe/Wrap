/**
 * WRAP CODE — Code Edit Skill
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition, SkillContext, SkillResult } from '../index.js';

function getFilesDir(): string {
  return process.env.WRAP_FILES_DIR || path.join(process.env.HOME || '/root', 'wrap-files');
}

function validatePath(filePath: string): { valid: boolean; resolved: string; error?: string } {
  const FILES_DIR = getFilesDir();
  const resolved = path.resolve(FILES_DIR, filePath);
  if (!resolved.startsWith(FILES_DIR)) return { valid: false, resolved, error: 'Access denied: path outside allowed directory' };
  if (filePath.includes('..')) return { valid: false, resolved, error: 'Access denied: path traversal' };
  return { valid: true, resolved };
}

export const codeEditSkill: SkillDefinition = {
  name: 'code.edit',
  description: 'Edit a file by replacing content. Supports string replacement or line-range editing.',
  category: 'code',
  permissions: ['fs:write'],
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file (relative to ~/wrap-files/)' },
      oldContent: { type: 'string', description: 'Content to find and replace' },
      newContent: { type: 'string', description: 'New content to insert' },
      startLine: { type: 'number', description: 'Start line for line-range editing' },
      endLine: { type: 'number', description: 'End line for line-range editing' },
    },
    required: ['filePath', 'newContent'],
  },
  required: ['filePath', 'newContent'],
  examples: [
    { description: 'Replace a variable name', params: { filePath: 'app.ts', oldContent: 'const x = 1', newContent: 'const x = 10' }, result: 'File edited' },
  ],
  handler: async (params: Record<string, unknown>): Promise<SkillResult> => {
    const filePath = params.filePath as string;
    const oldContent = params.oldContent as string | undefined;
    const newContent = params.newContent as string;
    const startLine = params.startLine as number | undefined;
    const endLine = params.endLine as number | undefined;

    const { valid, resolved, error } = validatePath(filePath);
    if (!valid) return { success: false, output: null, error };
    if (!fs.existsSync(resolved)) return { success: false, output: null, error: `File not found: ${filePath}` };

    const original = fs.readFileSync(resolved, 'utf-8');
    fs.writeFileSync(resolved + '.bak', original, 'utf-8');

    let result: string;
    if (oldContent !== undefined) {
      if (!original.includes(oldContent)) return { success: false, output: null, error: 'Content not found' };
      result = original.split(oldContent).join(newContent);
    } else if (startLine !== undefined && endLine !== undefined) {
      const lines = original.split('\n');
      lines.splice(startLine - 1, endLine - startLine + 1, ...newContent.split('\n'));
      result = lines.join('\n');
    } else {
      return { success: false, output: null, error: 'Provide oldContent or startLine+endLine' };
    }

    fs.writeFileSync(resolved, result, 'utf-8');
    return { success: true, output: `✅ Edited: ${filePath} (backup: ${filePath}.bak)` };
  },
};

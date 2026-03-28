/**
 * WRAP CODE — Code Edit Skill
 * Diff-based file editing with backup and audit trail
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition } from '../index';

function getFilesDir(): string {
  return process.env.WRAP_FILES_DIR || path.join(process.env.HOME || '/root', 'wrap-files');
}

function validatePath(filePath: string): { valid: boolean; resolved: string; error?: string } {
  const FILES_DIR = getFilesDir();
  const resolved = path.resolve(FILES_DIR, filePath);
  if (!resolved.startsWith(FILES_DIR)) {
    return { valid: false, resolved, error: 'Access denied: path is outside the allowed directory' };
  }
  if (filePath.includes('..')) {
    return { valid: false, resolved, error: 'Access denied: path traversal detected' };
  }
  return { valid: true, resolved };
}

export const codeEditSkill: SkillDefinition = {
  name: 'code.edit',
  description: 'Edit a file by replacing content. Supports string replacement or line-range editing. Creates a backup before modifying.',
  parameters: {
    filePath: { type: 'string', description: 'Path to the file (relative to ~/wrap-files/)', required: true },
    oldContent: { type: 'string', description: 'Content to find and replace (for string replacement mode)', required: false },
    newContent: { type: 'string', description: 'New content to insert', required: true },
    startLine: { type: 'number', description: 'Start line number for line-range editing (1-indexed)', required: false },
    endLine: { type: 'number', description: 'End line number for line-range editing (inclusive)', required: false },
  },
  async execute(params: Record<string, unknown>) {
    const filePath = params.filePath as string;
    const oldContent = params.oldContent as string | undefined;
    const newContent = params.newContent as string;
    const startLine = params.startLine as number | undefined;
    const endLine = params.endLine as number | undefined;

    const { valid, resolved, error } = validatePath(filePath);
    if (!valid) {
      return { success: false, output: error! };
    }

    if (!fs.existsSync(resolved)) {
      return { success: false, output: `File not found: ${filePath}` };
    }

    const original = fs.readFileSync(resolved, 'utf-8');

    // Create backup
    const backupPath = resolved + '.bak';
    fs.writeFileSync(backupPath, original, 'utf-8');

    let result: string;
    let linesAdded = 0;
    let linesRemoved = 0;

    if (oldContent !== undefined) {
      // String replacement mode
      if (!original.includes(oldContent)) {
        return { success: false, output: `Content not found in file. The exact text to replace was not found.` };
      }
      const occurrences = (original.split(oldContent).length - 1);
      result = original.split(oldContent).join(newContent);
      linesRemoved = oldContent.split('\n').length * occurrences;
      linesAdded = newContent.split('\n').length * occurrences;
    } else if (startLine !== undefined && endLine !== undefined) {
      // Line range mode
      const lines = original.split('\n');
      if (startLine < 1 || startLine > lines.length) {
        return { success: false, output: `Invalid start line: ${startLine}. File has ${lines.length} lines.` };
      }
      if (endLine < startLine || endLine > lines.length) {
        return { success: false, output: `Invalid end line: ${endLine}. Must be between ${startLine} and ${lines.length}.` };
      }
      linesRemoved = endLine - startLine + 1;
      const newLines = newContent.split('\n');
      linesAdded = newLines.length;
      lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
      result = lines.join('\n');
    } else {
      return { success: false, output: 'Must provide either oldContent (for string replacement) or startLine+endLine (for line-range editing).' };
    }

    fs.writeFileSync(resolved, result, 'utf-8');

    const summary = [
      `✅ Edited: ${filePath}`,
      `   Backup: ${filePath}.bak`,
      `   Lines removed: ${linesRemoved}`,
      `   Lines added: ${linesAdded}`,
      `   Net change: ${linesAdded - linesRemoved >= 0 ? '+' : ''}${linesAdded - linesRemoved}`,
    ].join('\n');

    return { success: true, output: summary, raw: { linesAdded, linesRemoved, backupPath } };
  },
};

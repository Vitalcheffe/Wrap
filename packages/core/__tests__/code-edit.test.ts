/**
 * WRAP CODE — Code Edit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { codeEditSkill } from '../src/skills/definitions/code.edit';

describe('code.edit skill', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-edit-test-'));
    originalEnv = process.env.WRAP_FILES_DIR;
    process.env.WRAP_FILES_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalEnv) process.env.WRAP_FILES_DIR = originalEnv;
    else delete process.env.WRAP_FILES_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should replace content in a file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'const x = 1;\nconst y = 2;', 'utf-8');
    const result = await codeEditSkill.execute({
      filePath: 'test.ts',
      oldContent: 'const x = 1;',
      newContent: 'const x = 10;',
    });
    expect(result.success).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toContain('const x = 10;');
    expect(content).toContain('const y = 2;');
  });

  it('should create a backup before editing', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'original content', 'utf-8');
    await codeEditSkill.execute({
      filePath: 'test.ts',
      oldContent: 'original',
      newContent: 'modified',
    });
    const backup = fs.readFileSync(path.join(tmpDir, 'test.ts.bak'), 'utf-8');
    expect(backup).toBe('original content');
  });

  it('should reject path traversal', async () => {
    const result = await codeEditSkill.execute({
      filePath: '../../../etc/passwd',
      oldContent: 'root',
      newContent: 'hacked',
    });
    expect(result.success).toBe(false);
  });

  it('should fail if oldContent not found', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'hello world', 'utf-8');
    const result = await codeEditSkill.execute({
      filePath: 'test.ts',
      oldContent: 'not found',
      newContent: 'replacement',
    });
    expect(result.success).toBe(false);
  });

  it('should edit by line range', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'line1\nline2\nline3\nline4', 'utf-8');
    const result = await codeEditSkill.execute({
      filePath: 'test.ts',
      startLine: 2,
      endLine: 3,
      newContent: 'replaced',
    });
    expect(result.success).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('line1\nreplaced\nline4');
  });
});

/**
 * WRAP CODE — Code Search Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { codeSearchSkill } from '../src/skills/definitions/code.search';

describe('code.search skill', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-search-test-'));
    originalEnv = process.env.WRAP_FILES_DIR;
    process.env.WRAP_FILES_DIR = tmpDir;

    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'function login() {\n  return authenticate();\n}', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'function helper() {\n  return 42;\n}', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# My Project', 'utf-8');
  });

  afterEach(() => {
    if (originalEnv) process.env.WRAP_FILES_DIR = originalEnv;
    else delete process.env.WRAP_FILES_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should find files by name pattern', async () => {
    const result = await codeSearchSkill.execute({ query: 'app', mode: 'find' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('app.ts');
  });

  it('should find symbols by name', async () => {
    const result = await codeSearchSkill.execute({ query: 'login', mode: 'symbol' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('login');
  });

  it('should return no matches for missing pattern', async () => {
    const result = await codeSearchSkill.execute({ query: 'nonexistent_function_xyz', mode: 'symbol' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No symbols');
  });
});

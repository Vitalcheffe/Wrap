/**
 * WRAP NEBULA — Skill Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Skills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-skill-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('code.edit', () => {
    it('should edit a file by string replacement', async () => {
      const { codeEditSkill } = await import('../src/skills/definitions/code.edit');
      process.env.WRAP_FILES_DIR = tmpDir;
      fs.writeFileSync(path.join(tmpDir, 'edit.ts'), 'const x = 1;', 'utf-8');
      const result = await codeEditSkill.handler({ filePath: 'edit.ts', oldContent: 'const x = 1;', newContent: 'const x = 10;' }, {} as any);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, 'edit.ts'), 'utf-8')).toBe('const x = 10;');
    });

    it('should create backup before editing', async () => {
      const { codeEditSkill } = await import('../src/skills/definitions/code.edit');
      process.env.WRAP_FILES_DIR = tmpDir;
      fs.writeFileSync(path.join(tmpDir, 'backup.ts'), 'original', 'utf-8');
      await codeEditSkill.handler({ filePath: 'backup.ts', oldContent: 'original', newContent: 'modified' }, {} as any);
      expect(fs.readFileSync(path.join(tmpDir, 'backup.ts.bak'), 'utf-8')).toBe('original');
    });

    it('should reject path traversal', async () => {
      const { codeEditSkill } = await import('../src/skills/definitions/code.edit');
      process.env.WRAP_FILES_DIR = tmpDir;
      const result = await codeEditSkill.handler({ filePath: '../../../etc/passwd', oldContent: 'x', newContent: 'y' }, {} as any);
      expect(result.success).toBe(false);
    });

    it('should fail if oldContent not found', async () => {
      const { codeEditSkill } = await import('../src/skills/definitions/code.edit');
      process.env.WRAP_FILES_DIR = tmpDir;
      fs.writeFileSync(path.join(tmpDir, 'nomatch.ts'), 'hello world', 'utf-8');
      const result = await codeEditSkill.handler({ filePath: 'nomatch.ts', oldContent: 'not found', newContent: 'x' }, {} as any);
      expect(result.success).toBe(false);
    });

    it('should edit by line range', async () => {
      const { codeEditSkill } = await import('../src/skills/definitions/code.edit');
      process.env.WRAP_FILES_DIR = tmpDir;
      fs.writeFileSync(path.join(tmpDir, 'lines.ts'), 'line1\nline2\nline3\nline4', 'utf-8');
      const result = await codeEditSkill.handler({ filePath: 'lines.ts', startLine: 2, endLine: 3, newContent: 'replaced' }, {} as any);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, 'lines.ts'), 'utf-8')).toBe('line1\nreplaced\nline4');
    });
  });

  describe('code.run', () => {
    it('should block dangerous patterns', async () => {
      const { codeRunSkill } = await import('../src/skills/definitions/code.run');
      const result = await codeRunSkill.handler({ language: 'javascript', code: "require('child_process').execSync('rm -rf /')" }, {} as any);
      expect(result.success).toBe(false);
    });

    it('should block fs access', async () => {
      const { codeRunSkill } = await import('../src/skills/definitions/code.run');
      const result = await codeRunSkill.handler({ language: 'javascript', code: "require('fs').readFileSync('/etc/passwd')" }, {} as any);
      expect(result.success).toBe(false);
    });

    it('should block process.env access', async () => {
      const { codeRunSkill } = await import('../src/skills/definitions/code.run');
      const result = await codeRunSkill.handler({ language: 'javascript', code: "console.log(process.env.HOME)" }, {} as any);
      expect(result.success).toBe(false);
    });
  });

  describe('terminal.run', () => {
    it('should block rm -rf', async () => {
      const { terminalRunSkill } = await import('../src/skills/definitions/terminal.run');
      const result = await terminalRunSkill.handler({ command: 'rm -rf /' }, {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });

    it('should block /etc/passwd access', async () => {
      const { terminalRunSkill } = await import('../src/skills/definitions/terminal.run');
      const result = await terminalRunSkill.handler({ command: 'cat /etc/passwd' }, {} as any);
      expect(result.success).toBe(false);
    });

    it('should block chmod 777', async () => {
      const { terminalRunSkill } = await import('../src/skills/definitions/terminal.run');
      const result = await terminalRunSkill.handler({ command: 'chmod 777 /' }, {} as any);
      expect(result.success).toBe(false);
    });
  });

  describe('code.search', () => {
    it('should find files by name', async () => {
      const { codeSearchSkill } = await import('../src/skills/definitions/code.search');
      process.env.WRAP_FILES_DIR = tmpDir;
      fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'hello', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'utils.py'), 'world', 'utf-8');
      const result = await codeSearchSkill.handler({ query: 'app', mode: 'find' }, {} as any);
      expect(result.success).toBe(true);
      expect(result.output).toContain('app.ts');
    });

    it('should reject path outside allowed dir', async () => {
      const { codeSearchSkill } = await import('../src/skills/definitions/code.search');
      process.env.WRAP_FILES_DIR = tmpDir;
      const result = await codeSearchSkill.handler({ query: 'x', directory: '/etc' }, {} as any);
      expect(result.success).toBe(false);
    });
  });

  describe('project.context', () => {
    it('should return project files', async () => {
      const { projectContextSkill } = await import('../src/skills/definitions/project.context');
      process.env.WRAP_FILES_DIR = tmpDir;
      fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export {};', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'export {};', 'utf-8');
      const result = await projectContextSkill.handler({ projectRoot: '.', maxFiles: 2 }, {} as any);
      expect(result.success).toBe(true);
      expect(result.output).toContain('index.ts');
    });
  });
});

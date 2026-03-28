/**
 * WRAP NEBULA v2.0 - VFS Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFS } from '../src/vfs/index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('VFS', () => {
  let vfs: VFS;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-vfs-test-'));
    vfs = new VFS({ root: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write and read a file', async () => {
    await vfs.write('test.txt', Buffer.from('hello world'));
    const content = await vfs.read('test.txt');
    expect(content.toString()).toBe('hello world');
  });

  it('should list directory contents', async () => {
    await vfs.write('a.txt', Buffer.from('a'));
    await vfs.write('b.txt', Buffer.from('b'));
    const entries = await vfs.list('/');
    const names = entries.map(e => e.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.txt');
  });

  it('should delete a file', async () => {
    await vfs.write('delete-me.txt', Buffer.from('bye'));
    await vfs.delete('delete-me.txt');
    await expect(vfs.read('delete-me.txt')).rejects.toThrow();
  });

  it('should reject path traversal', async () => {
    await expect(vfs.read('../../../etc/passwd')).rejects.toThrow();
  });

  it('should handle nested directories', async () => {
    await vfs.write('dir/nested/file.txt', Buffer.from('deep'));
    const content = await vfs.read('dir/nested/file.txt');
    expect(content.toString()).toBe('deep');
  });

  it('should report file size', async () => {
    const data = 'x'.repeat(1024);
    await vfs.write('big.txt', Buffer.from(data));
    const entries = await vfs.list('/');
    const file = entries.find(e => e.name === 'big.txt');
    expect(file?.size).toBe(1024);
  });
});

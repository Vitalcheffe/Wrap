/**
 * WRAP CODE — Terminal Run Tests
 */

import { describe, it, expect } from 'vitest';
import { terminalRunSkill } from '../src/skills/definitions/terminal.run';

describe('terminal.run skill', () => {
  it('should block dangerous commands', async () => {
    const result = await terminalRunSkill.execute({ command: 'rm -rf /' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('blocked');
  });

  it('should block reading sensitive files', async () => {
    const result = await terminalRunSkill.execute({ command: 'cat /etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('should report exit codes on failure', async () => {
    const result = await terminalRunSkill.execute({ command: 'ls /nonexistent_path_xyz_12345' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Exit');
  });
});

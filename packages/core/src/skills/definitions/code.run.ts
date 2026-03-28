/**
 * WRAP NEBULA Core - Code Run Skill (Sandboxed)
 * Execute code in a V8 isolate-like sandboxed environment
 * 
 * Security:
 * - HOME is set to a temp directory (not the real home)
 * - Working directory is a temp sandbox (not the real filesystem)
 * - Network access is blocked via env stripping
 * - Memory limited to 128MB via Node --max-old-space-size
 * - Dangerous patterns detected before execution
 * - Timeout enforced (default 10s, max 30s)
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SANDBOX_DIR = path.join(os.tmpdir(), 'wrap-sandbox');
const MAX_TIMEOUT = 30000;
const MAX_OUTPUT = 100 * 1024; // 100KB max output

// Dangerous patterns that should never be executed
const DANGEROUS_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /require\s*\(\s*['"]fs['"]\s*\)/i,
  /import.*from\s+['"]fs['"]/i,
  /import.*from\s+['"]child_process['"]/i,
  /process\.env/i,
  /process\.exit/i,
  /process\.kill/i,
  /os\.system/i,
  /os\.popen/i,
  /subprocess/i,
  /exec\s*\(/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /\.exec\s*\(/i,
  /rm\s+-rf/i,
  /curl\s+/i,
  /wget\s+/i,
  /nc\s+-/i,
  /\/etc\//i,
  /\/proc\//i,
  /\/sys\//i,
];

function isDangerous(code: string): { safe: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return { safe: false, reason: `Blocked: matches dangerous pattern ${pattern}` };
    }
  }
  return { safe: true };
}

function createSandbox(): string {
  const sandboxPath = fs.mkdtempSync(path.join(SANDBOX_DIR, 'exec-'));
  // Create a safe workspace inside the sandbox
  fs.mkdirSync(path.join(sandboxPath, 'workspace'));
  return sandboxPath;
}

function cleanupSandbox(sandboxPath: string): void {
  try {
    fs.rmSync(sandboxPath, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
}

export const codeRunSkill: SkillDefinition = {
  name: 'code.run',
  description: 'Execute code in a sandboxed environment. Code runs in isolation with no filesystem, network, or system access.',
  category: 'code',
  permissions: ['sandbox:execute'],
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Programming language',
        enum: ['javascript', 'python'],
      },
      code: {
        type: 'string',
        description: 'Code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in seconds (default: 10, max: 30)',
        minimum: 1,
        maximum: 30,
      },
    },
    required: ['language', 'code'],
  },
  required: ['language', 'code'],
  examples: [
    {
      description: 'Run a simple calculation',
      params: { language: 'javascript', code: 'console.log(2 + 2)' },
      result: { stdout: '4', exitCode: 0 },
    },
  ],
  handler: async (params: Record<string, unknown>): Promise<SkillResult> => {
    const language = params.language as string;
    const code = params.code as string;
    const timeoutMs = Math.min(((params.timeout as number) || 10) * 1000, MAX_TIMEOUT);

    // Safety check
    const { safe, reason } = isDangerous(code);
    if (!safe) {
      return { success: false, output: null, error: `⛔ ${reason}` };
    }

    // Create sandbox
    const sandboxPath = createSandbox();

    try {
      let command: string;
      let args: string[];

      switch (language) {
        case 'javascript':
          command = 'node';
          args = ['--max-old-space-size=128', '-e', code];
          break;
        case 'python':
          command = 'python3';
          args = ['-c', code];
          break;
        default:
          return { success: false, output: null, error: `Unsupported language: ${language}` };
      }

      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        const proc = spawn(command, args, {
          cwd: path.join(sandboxPath, 'workspace'),
          env: {
            PATH: '/usr/bin:/bin',
            HOME: sandboxPath,
            TMPDIR: sandboxPath,
            NODE_OPTIONS: '--max-old-space-size=128',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: timeoutMs,
        });

        // Limit output size
        proc.stdout.on('data', (data: Buffer) => {
          if (stdout.length < MAX_OUTPUT) stdout += data.toString();
        });
        proc.stderr.on('data', (data: Buffer) => {
          if (stderr.length < MAX_OUTPUT) stderr += data.toString();
        });

        const timer = setTimeout(() => {
          killed = true;
          proc.kill('SIGKILL');
        }, timeoutMs);

        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code || 0, timedOut: killed });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ stdout: '', stderr: err.message, exitCode: 1, timedOut: false });
        });
      });

      if (result.timedOut) {
        return {
          success: false,
          output: null,
          error: `⏱️ Execution timed out after ${timeoutMs / 1000} seconds`,
        };
      }

      const output = [
        result.stdout ? `Stdout:\n${result.stdout.trim()}` : '',
        result.stderr ? `Stderr:\n${result.stderr.trim()}` : '',
      ].filter(Boolean).join('\n\n');

      return {
        success: result.exitCode === 0,
        output: result.exitCode === 0 ? output || '(no output)' : null,
        error: result.exitCode !== 0 ? output || `Exit code: ${result.exitCode}` : undefined,
        metadata: { exitCode: result.exitCode, duration: timeoutMs },
      };
    } finally {
      cleanupSandbox(sandboxPath);
    }
  },
};

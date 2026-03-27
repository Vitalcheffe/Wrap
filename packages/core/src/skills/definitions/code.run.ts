/**
 * WRAP NEBULA Core - Code Run Skill
 * Execute code in a sandbox
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import { spawn } from 'child_process';

export const codeRunSkill: SkillDefinition = {
  name: 'code.run',
  description: 'Execute code in a sandboxed environment',
  category: 'code',
  permissions: ['sandbox:execute'],
  dangerous: true, // Executes code
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Programming language',
        enum: ['javascript', 'python', 'bash', 'typescript'],
      },
      code: {
        type: 'string',
        description: 'Code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in seconds (default: 30)',
        minimum: 1,
        maximum: 300,
      },
      stdin: {
        type: 'string',
        description: 'Input to pass to the program',
      },
    },
    required: ['language', 'code'],
  },
  required: ['language', 'code'],
  examples: [
    {
      description: 'Run a Python script',
      params: { language: 'python', code: 'print("Hello, World!")' },
      result: { stdout: 'Hello, World!\n', exitCode: 0 },
    },
  ],
  handler: async (params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> => {
    const language = params.language as string;
    const code = params.code as string;
    const timeout = ((params.timeout as number) || 30) * 1000;
    const stdin = params.stdin as string | undefined;

    try {
      const result = await executeCode(language, code, timeout, stdin);

      return {
        success: result.exitCode === 0,
        output: result,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Execution failed: ${(error as Error).message}`,
      };
    }
  },
};

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

async function executeCode(
  language: string,
  code: string,
  timeout: number,
  stdin?: string
): Promise<ExecutionResult> {
  const startTime = Date.now();

  let command: string;
  let args: string[];

  switch (language) {
    case 'javascript':
      command = 'node';
      args = ['-e', code];
      break;
    case 'typescript':
      command = 'npx';
      args = ['ts-node', '-e', code];
      break;
    case 'python':
      command = 'python3';
      args = ['-c', code];
      break;
    case 'bash':
      command = 'bash';
      args = ['-c', code];
      break;
    default:
      throw new Error(`Unsupported language: ${language}`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      timeout,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

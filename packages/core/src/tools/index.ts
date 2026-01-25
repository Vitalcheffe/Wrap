/**
 * WRAP Tools - Built-in Tool Implementations
 * @module @wrap/core/tools
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type {
  Tool, ToolHandler, ToolContext, ToolMetadata, ToolExample,
  JSONSchema, Permission, ValidationResult
} from '../types';

// ============================================================================
// TOOL BUILDER
// ============================================================================

export class ToolBuilder {
  private _name: string = '';
  private _description: string = '';
  private _inputSchema: z.ZodType<any> | JSONSchema = z.object({});
  private _outputSchema?: z.ZodType<any> | JSONSchema;
  private _handler: ToolHandler = async () => null;
  private _destructive: boolean = false;
  private _permissions: Permission[] = [];
  private _timeout: number = 30000;
  private _streaming: boolean = false;
  private _metadata: Partial<ToolMetadata> = {};

  name(name: string): this {
    this._name = name;
    return this;
  }

  description(desc: string): this {
    this._description = desc;
    return this;
  }

  input(schema: z.ZodType<any> | JSONSchema): this {
    this._inputSchema = schema;
    return this;
  }

  output(schema: z.ZodType<any> | JSONSchema): this {
    this._outputSchema = schema;
    return this;
  }

  handler(fn: ToolHandler): this {
    this._handler = fn;
    return this;
  }

  destructive(value: boolean = true): this {
    this._destructive = value;
    return this;
  }

  permissions(...perms: Permission[]): this {
    this._permissions = perms;
    return this;
  }

  timeout(ms: number): this {
    this._timeout = ms;
    return this;
  }

  streaming(enabled: boolean = true): this {
    this._streaming = enabled;
    return this;
  }

  metadata(meta: Partial<ToolMetadata>): this {
    this._metadata = { ...this._metadata, ...meta };
    return this;
  }

  build(): Tool {
    if (!this._name) throw new Error('Tool name is required');
    if (!this._description) throw new Error('Tool description is required');

    return {
      name: this._name,
      description: this._description,
      inputSchema: this._inputSchema,
      outputSchema: this._outputSchema,
      handler: this._handler,
      destructive: this._destructive,
      permissions: this._permissions,
      timeout: this._timeout,
      retry: { maxAttempts: 3, backoff: 'exponential', initialDelay: 100, maxDelay: 5000, jitter: true },
      streaming: this._streaming,
      metadata: {
        version: '1.0.0',
        category: 'general',
        tags: [],
        examples: [],
        ...this._metadata
      },
      enabled: true
    };
  }
}

// ============================================================================
// FILE TOOLS
// ============================================================================

export const FileReadTool: Tool = {
  name: 'file_read',
  description: 'Read the contents of a file from the filesystem',
  inputSchema: z.object({
    path: z.string().describe('The path to the file to read'),
    encoding: z.enum(['utf-8', 'binary', 'base64']).optional().default('utf-8').describe('The encoding to use')
  }),
  outputSchema: z.object({
    content: z.union([z.string(), z.instanceof(Buffer)]),
    size: z.number(),
    path: z.string()
  }),
  handler: async (input: { path: string; encoding?: string }, ctx: ToolContext) => {
    const content = await ctx.fs.readFile(input.path, input.encoding as BufferEncoding);
    return { content, size: content.length, path: input.path };
  },
  destructive: false,
  permissions: ['fs.read'],
  timeout: 30000,
  retry: { maxAttempts: 3, backoff: 'exponential', initialDelay: 100, maxDelay: 5000, jitter: true },
  streaming: false,
  metadata: {
    version: '1.0.0',
    category: 'filesystem',
    tags: ['file', 'read', 'io'],
    examples: [
      { description: 'Read a text file', input: { path: '/tmp/example.txt' }, output: { content: 'Hello World', size: 11, path: '/tmp/example.txt' } }
    ]
  },
  enabled: true
};

export const FileWriteTool: Tool = {
  name: 'file_write',
  description: 'Write content to a file on the filesystem',
  inputSchema: z.object({
    path: z.string().describe('The path to the file to write'),
    content: z.union([z.string(), z.instanceof(Buffer)]).describe('The content to write'),
    encoding: z.enum(['utf-8', 'binary', 'base64']).optional().default('utf-8'),
    append: z.boolean().optional().default(false).describe('Whether to append to the file')
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    bytesWritten: z.number()
  }),
  handler: async (input: { path: string; content: string | Buffer; encoding?: string; append?: boolean }, ctx: ToolContext) => {
    const data = typeof input.content === 'string' ? input.content : input.content;
    if (input.append) {
      await ctx.fs.appendFile(input.path, data);
    } else {
      await ctx.fs.writeFile(input.path, data);
    }
    return { success: true, path: input.path, bytesWritten: data.length };
  },
  destructive: true,
  permissions: ['fs.write'],
  timeout: 30000,
  retry: { maxAttempts: 3, backoff: 'exponential', initialDelay: 100, maxDelay: 5000, jitter: true },
  streaming: false,
  metadata: {
    version: '1.0.0',
    category: 'filesystem',
    tags: ['file', 'write', 'io'],
    examples: [
      { description: 'Write to a file', input: { path: '/tmp/example.txt', content: 'Hello World' }, output: { success: true, path: '/tmp/example.txt', bytesWritten: 11 } }
    ]
  },
  enabled: true
};

export const FileListTool: Tool = {
  name: 'file_list',
  description: 'List files and directories in a path',
  inputSchema: z.object({
    path: z.string().describe('The directory path to list'),
    recursive: z.boolean().optional().default(false).describe('Whether to list recursively'),
    pattern: z.string().optional().describe('Glob pattern to filter files')
  }),
  outputSchema: z.object({
    files: z.array(z.object({
      name: z.string(),
      path: z.string(),
      isDirectory: z.boolean(),
      size: z.number().optional()
    })),
    path: z.string()
  }),
  handler: async (input: { path: string; recursive?: boolean; pattern?: string }, ctx: ToolContext) => {
    const entries = await ctx.fs.readdir(input.path);
    const files = entries.map(name => ({
      name: typeof name === 'string' ? name : name.name,
      path: input.path + '/' + (typeof name === 'string' ? name : name.name),
      isDirectory: false
    }));
    return { files, path: input.path };
  },
  destructive: false,
  permissions: ['fs.read'],
  timeout: 10000,
  retry: { maxAttempts: 2, backoff: 'fixed', initialDelay: 100, maxDelay: 500, jitter: false },
  streaming: false,
  metadata: {
    version: '1.0.0',
    category: 'filesystem',
    tags: ['file', 'list', 'directory'],
    examples: [
      { description: 'List current directory', input: { path: '.' }, output: { files: [], path: '.' } }
    ]
  },
  enabled: true
};

export const FileDeleteTool: Tool = {
  name: 'file_delete',
  description: 'Delete a file from the filesystem',
  inputSchema: z.object({
    path: z.string().describe('The path to the file to delete')
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string()
  }),
  handler: async (input: { path: string }, ctx: ToolContext) => {
    await ctx.fs.deleteFile(input.path);
    return { success: true, path: input.path };
  },
  destructive: true,
  permissions: ['fs.delete'],
  timeout: 10000,
  retry: { maxAttempts: 1, backoff: 'fixed', initialDelay: 0, maxDelay: 0, jitter: false },
  streaming: false,
  metadata: {
    version: '1.0.0',
    category: 'filesystem',
    tags: ['file', 'delete', 'dangerous'],
    examples: [
      { description: 'Delete a file', input: { path: '/tmp/example.txt' }, output: { success: true, path: '/tmp/example.txt' } }
    ]
  },
  enabled: true
};

// ============================================================================
// SHELL TOOL
// ============================================================================

export const ShellTool: Tool = {
  name: 'shell_execute',
  description: 'Execute a shell command in the sandbox',
  inputSchema: z.object({
    command: z.string().describe('The command to execute'),
    args: z.array(z.string()).optional().describe('Command arguments'),
    cwd: z.string().optional().describe('Working directory'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    env: z.record(z.string()).optional().describe('Environment variables')
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    duration: z.number()
  }),
  handler: async (input: { command: string; args?: string[]; cwd?: string; timeout?: number; env?: Record<string, string> }, ctx: ToolContext) => {
    const startTime = Date.now();
    // Placeholder - would execute in sandbox
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      duration: Date.now() - startTime
    };
  },
  destructive: true,
  permissions: ['exec.shell'],
  timeout: 60000,
  retry: { maxAttempts: 1, backoff: 'fixed', initialDelay: 0, maxDelay: 0, jitter: false },
  streaming: true,
  metadata: {
    version: '1.0.0',
    category: 'execution',
    tags: ['shell', 'command', 'dangerous'],
    examples: [
      { description: 'List files', input: { command: 'ls', args: ['-la'] }, output: { stdout: '', stderr: '', exitCode: 0, duration: 100 } }
    ]
  },
  enabled: true
};

// ============================================================================
// WEB TOOLS
// ============================================================================

export const WebFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch content from a URL',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to fetch'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET'),
    headers: z.record(z.string()).optional().describe('Request headers'),
    body: z.unknown().optional().describe('Request body'),
    timeout: z.number().optional().default(30000)
  }),
  outputSchema: z.object({
    status: z.number(),
    statusText: z.string(),
    headers: z.record(z.string()),
    body: z.unknown()
  }),
  handler: async (input: { url: string; method?: string; headers?: Record<string, string>; body?: unknown; timeout?: number }, ctx: ToolContext) => {
    const response = await ctx.network.fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      timeout: input.timeout
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text()
    };
  },
  destructive: false,
  permissions: ['network.http'],
  timeout: 30000,
  retry: { maxAttempts: 3, backoff: 'exponential', initialDelay: 500, maxDelay: 10000, jitter: true },
  streaming: false,
  metadata: {
    version: '1.0.0',
    category: 'network',
    tags: ['http', 'fetch', 'web'],
    examples: [
      { description: 'Fetch a webpage', input: { url: 'https://example.com' }, output: { status: 200, statusText: 'OK', headers: {}, body: '' } }
    ]
  },
  enabled: true
};

export const WebSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for information',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    numResults: z.number().optional().default(10).describe('Number of results to return')
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string()
    }))
  }),
  handler: async (input: { query: string; numResults?: number }, ctx: ToolContext) => {
    // Placeholder - would integrate with search API
    return {
      results: []
    };
  },
  destructive: false,
  permissions: ['network.http'],
  timeout: 30000,
  retry: { maxAttempts: 3, backoff: 'exponential', initialDelay: 500, maxDelay: 10000, jitter: true },
  streaming: false,
  metadata: {
    version: '1.0.0',
    category: 'network',
    tags: ['search', 'web'],
    examples: [
      { description: 'Search for something', input: { query: 'hello world' }, output: { results: [] } }
    ]
  },
  enabled: true
};

// ============================================================================
// CODE EXECUTION TOOL
// ============================================================================

export const CodeExecuteTool: Tool = {
  name: 'code_execute',
  description: 'Execute code in a sandboxed environment',
  inputSchema: z.object({
    code: z.string().describe('The code to execute'),
    language: z.enum(['javascript', 'typescript', 'python']).describe('The programming language'),
    timeout: z.number().optional().default(10000).describe('Timeout in milliseconds')
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    result: z.unknown(),
    duration: z.number()
  }),
  handler: async (input: { code: string; language: string; timeout?: number }, ctx: ToolContext) => {
    const startTime = Date.now();
    // Placeholder - would execute in sandbox
    return {
      stdout: '',
      stderr: '',
      result: null,
      duration: Date.now() - startTime
    };
  },
  destructive: true,
  permissions: ['exec.code'],
  timeout: 30000,
  retry: { maxAttempts: 1, backoff: 'fixed', initialDelay: 0, maxDelay: 0, jitter: false },
  streaming: true,
  metadata: {
    version: '1.0.0',
    category: 'execution',
    tags: ['code', 'execute', 'dangerous'],
    examples: [
      { description: 'Execute JavaScript', input: { code: 'console.log("Hello")', language: 'javascript' }, output: { stdout: 'Hello\n', stderr: '', result: undefined, duration: 10 } }
    ]
  },
  enabled: true
};

// ============================================================================
// MEMORY TOOL
// ============================================================================

export const MemoryTool: Tool = {
  name: 'memory',
  description: 'Store and retrieve data from memory',
  inputSchema: z.object({
    operation: z.enum(['get', 'set', 'delete', 'list', 'clear']).describe('The operation to perform'),
    key: z.string().optional().describe('The key for get/set/delete operations'),
    value: z.unknown().optional().describe('The value for set operation')
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional()
  }),
  handler: async (input: { operation: string; key?: string; value?: unknown }, ctx: ToolContext) => {
    // Placeholder - would use persistent memory
    return { success: true, data: input.value };
  },
  destructive: false,
  permissions: [],
  timeout: 5000,
  retry: { maxAttempts: 1, backoff: 'fixed', initialDelay: 0, maxDelay: 0, jitter: false },
  streaming: false,
  metadata: {
    version: '1.0.0',
    category: 'utility',
    tags: ['memory', 'storage'],
    examples: [
      { description: 'Store a value', input: { operation: 'set', key: 'foo', value: 'bar' }, output: { success: true } }
    ]
  },
  enabled: true
};

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export class ToolRegistry {
  private _tools: Map<string, Tool> = new Map();
  private _categories: Map<string, Set<string>> = new Map();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool): void {
    this._tools.set(tool.name, tool);
    const category = tool.metadata?.category ?? 'general';
    if (!this._categories.has(category)) {
      this._categories.set(category, new Set());
    }
    this._categories.get(category)!.add(tool.name);
  }

  unregister(name: string): void {
    const tool = this._tools.get(name);
    if (tool) {
      this._tools.delete(name);
      const category = tool.metadata?.category ?? 'general';
      this._categories.get(category)?.delete(name);
    }
  }

  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this._tools.values());
  }

  byCategory(category: string): Tool[] {
    const names = this._categories.get(category);
    if (!names) return [];
    return Array.from(names)
      .map(name => this._tools.get(name))
      .filter((t): t is Tool => t !== undefined);
  }

  validate(name: string, input: unknown): ValidationResult {
    const tool = this._tools.get(name);
    if (!tool) {
      return { valid: false, errors: [{ path: '', message: `Tool ${name} not found` }] };
    }

    try {
      const schema = tool.inputSchema;
      if ('parse' in schema && typeof schema.parse === 'function') {
        schema.parse(input);
      }
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: [{
          path: '',
          message: error instanceof Error ? error.message : String(error)
        }]
      };
    }
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this._tools.get(name);
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }
    return tool.handler(input, context);
  }

  getSchemas(): Array<{ type: 'function'; function: { name: string; description: string; parameters: JSONSchema } }> {
    return this.list().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as JSONSchema
      }
    }));
  }
}

// ============================================================================
// BUILT-IN TOOLS LIST
// ============================================================================

export const builtInTools: Tool[] = [
  FileReadTool,
  FileWriteTool,
  FileListTool,
  FileDeleteTool,
  ShellTool,
  WebFetchTool,
  WebSearchTool,
  CodeExecuteTool,
  MemoryTool
];

export default {
  ToolBuilder,
  ToolRegistry,
  builtInTools,
  FileReadTool,
  FileWriteTool,
  FileListTool,
  FileDeleteTool,
  ShellTool,
  WebFetchTool,
  WebSearchTool,
  CodeExecuteTool,
  MemoryTool
};

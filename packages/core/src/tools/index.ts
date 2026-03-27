/**
 * WRAP NEBULA v2.0 - Tools Manager
 * Tool registry and execution management
 */

import * as crypto from 'crypto';
import {
  ToolDefinition,
  ToolResult,
  ToolContext,
  ToolHandler,
  ToolMiddleware,
  JSONSchema,
  RegisteredTool,
  ValidationError,
  WrapError,
} from '../types';

// ============================================================================
// Types
// ============================================================================

export interface ToolsManagerConfig {
  maxConcurrent: number;
  defaultTimeout: number;
  enableCache: boolean;
  cacheTTL: number;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  duration: number;
  cached: boolean;
}

export interface ToolStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageDuration: number;
  cacheHits: number;
  cacheMisses: number;
}

// ============================================================================
// Tools Manager Implementation
// ============================================================================

export class ToolsManager {
  private tools: Map<string, RegisteredTool> = new Map();
  private categories: Map<string, Set<string>> = new Map();
  private config: ToolsManagerConfig;
  private stats: Map<string, ToolStats> = new Map();
  private cache: Map<string, { result: ToolResult; timestamp: number }> = new Map();
  private executionQueue: Array<() => Promise<void>> = [];
  private runningExecutions: number = 0;

  constructor(config: Partial<ToolsManagerConfig> = {}) {
    this.config = {
      maxConcurrent: 10,
      defaultTimeout: 30000,
      enableCache: true,
      cacheTTL: 60000,
      ...config,
    };
  }

  /**
   * Register a tool
   */
  register(
    definition: ToolDefinition,
    handler: ToolHandler,
    options: {
      middleware?: ToolMiddleware[];
      permissions?: string[];
      category?: string;
    } = {}
  ): void {
    // Validate definition
    this.validateDefinition(definition);

    // Create registered tool
    const registered: RegisteredTool = {
      definition,
      handler,
      middleware: options.middleware || [],
      permissions: options.permissions || [],
    };

    // Add to registry
    this.tools.set(definition.name, registered);

    // Add to category
    if (options.category) {
      if (!this.categories.has(options.category)) {
        this.categories.set(options.category, new Set());
      }
      this.categories.get(options.category)!.add(definition.name);
    }

    // Initialize stats
    this.stats.set(definition.name, {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageDuration: 0,
      cacheHits: 0,
      cacheMisses: 0,
    });
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;

    this.tools.delete(name);
    this.stats.delete(name);

    // Remove from categories
    for (const [category, tools] of this.categories) {
      tools.delete(name);
      if (tools.size === 0) {
        this.categories.delete(category);
      }
    }

    return true;
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const toolCallId = crypto.randomUUID();
    const startTime = Date.now();

    // Get tool
    const registered = this.tools.get(name);
    if (!registered) {
      throw new WrapError(`Tool not found: ${name}`, 'TOOL_NOT_FOUND');
    }

    // Validate parameters
    this.validateParameters(registered.definition, params);

    // Check cache
    if (this.config.enableCache) {
      const cacheKey = this.getCacheKey(name, params);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        this.updateStats(name, true, true, 0);
        return {
          toolCallId,
          toolName: name,
          result: cached.result,
          duration: 0,
          cached: true,
        };
      }
    }

    // Execute with middleware
    const result = await this.executeWithMiddleware(registered, params, context);

    // Update stats
    const duration = Date.now() - startTime;
    this.updateStats(name, result.success, false, duration);

    // Cache result
    if (this.config.enableCache && result.success) {
      const cacheKey = this.getCacheKey(name, params);
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
    }

    return {
      toolCallId,
      toolName: name,
      result,
      duration,
      cached: false,
    };
  }

  /**
   * Execute with middleware chain
   */
  private async executeWithMiddleware(
    registered: RegisteredTool,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    // Build middleware chain
    let handler = registered.handler;

    const middleware = registered.middleware as ToolMiddleware[] | undefined;
    
    // Apply middleware in reverse order
    if (middleware) {
      for (let i = middleware.length - 1; i >= 0; i--) {
        const mw = middleware[i];
        const nextHandler = handler;
        handler = async (p, ctx) => {
          return mw(p, ctx, () => nextHandler(p, ctx));
        };
      }
    }

    // Execute with timeout
    const timeout = registered.definition.timeout || this.config.defaultTimeout;
    
    return new Promise<ToolResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new WrapError(`Tool execution timed out after ${timeout}ms`, 'TIMEOUT'));
      }, timeout);

      handler(params, context)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeParallel(
    calls: Array<{ name: string; params: Record<string, unknown> }>,
    context: ToolContext
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    const chunks: Array<typeof calls> = [];

    // Split into chunks based on max concurrent
    for (let i = 0; i < calls.length; i += this.config.maxConcurrent) {
      chunks.push(calls.slice(i, i + this.config.maxConcurrent));
    }

    // Execute chunks sequentially
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(call => this.execute(call.name, call.params, context))
      );
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * List all tools
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * List tools by category
   */
  listByCategory(category: string): ToolDefinition[] {
    const toolNames = this.categories.get(category);
    if (!toolNames) return [];

    return Array.from(toolNames)
      .map(name => this.tools.get(name)?.definition)
      .filter((t): t is ToolDefinition => t !== undefined);
  }

  /**
   * Get tool definition
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool stats
   */
  getStats(name: string): ToolStats | undefined {
    return this.stats.get(name);
  }

  /**
   * Get all stats
   */
  getAllStats(): Map<string, ToolStats> {
    return new Map(this.stats);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get categories
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Validate tool definition
   */
  private validateDefinition(definition: ToolDefinition): void {
    if (!definition.name || typeof definition.name !== 'string') {
      throw new ValidationError('Tool name is required');
    }

    if (!definition.name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
      throw new ValidationError(`Invalid tool name: ${definition.name}`);
    }

    if (!definition.description || typeof definition.description !== 'string') {
      throw new ValidationError('Tool description is required');
    }

    if (!definition.parameters || typeof definition.parameters !== 'object') {
      throw new ValidationError('Tool parameters schema is required');
    }

    // Validate JSON schema structure
    this.validateJSONSchema(definition.parameters);
  }

  /**
   * Validate JSON schema
   */
  private validateJSONSchema(schema: JSONSchema, path: string = ''): void {
    const validTypes = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

    if (schema.type && !validTypes.includes(schema.type)) {
      throw new ValidationError(`Invalid schema type at ${path}: ${schema.type}`);
    }

    if (schema.type === 'object' && schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        this.validateJSONSchema(value, `${path}.properties.${key}`);
      }
    }

    if (schema.type === 'array' && schema.items) {
      this.validateJSONSchema(schema.items, `${path}.items`);
    }

    if (schema.oneOf) {
      schema.oneOf.forEach((s, i) => this.validateJSONSchema(s, `${path}.oneOf[${i}]`));
    }

    if (schema.anyOf) {
      schema.anyOf.forEach((s, i) => this.validateJSONSchema(s, `${path}.anyOf[${i}]`));
    }

    if (schema.allOf) {
      schema.allOf.forEach((s, i) => this.validateJSONSchema(s, `${path}.allOf[${i}]`));
    }
  }

  /**
   * Validate parameters against schema
   */
  private validateParameters(definition: ToolDefinition, params: Record<string, unknown>): void {
    const schema = definition.parameters;

    // Check required fields
    if (definition.required) {
      for (const field of definition.required) {
        if (params[field] === undefined) {
          throw new ValidationError(`Missing required parameter: ${field}`);
        }
      }
    }

    // Type validation
    this.validateAgainstSchema(params, schema, definition.name);
  }

  /**
   * Validate value against JSON schema
   */
  private validateAgainstSchema(
    value: unknown,
    schema: JSONSchema,
    path: string
  ): void {
    if (value === undefined) return;

    // Type check
    if (schema.type) {
      const actualType = this.getValueType(value);
      if (!this.isTypeMatch(actualType, schema.type)) {
        throw new ValidationError(`Type mismatch at ${path}: expected ${schema.type}, got ${actualType}`);
      }
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value as string)) {
      throw new ValidationError(`Invalid value at ${path}: must be one of ${schema.enum.join(', ')}`);
    }

    // Object validation
    if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (obj[key] !== undefined) {
          this.validateAgainstSchema(obj[key], propSchema, `${path}.${key}`);
        }
      }
    }

    // Array validation
    if (schema.type === 'array' && Array.isArray(value) && schema.items) {
      value.forEach((item, index) => {
        this.validateAgainstSchema(item, schema.items!, `${path}[${index}]`);
      });
    }

    // String constraints
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new ValidationError(`String too short at ${path}: minimum ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new ValidationError(`String too long at ${path}: maximum ${schema.maxLength} characters`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        throw new ValidationError(`String does not match pattern at ${path}: ${schema.pattern}`);
      }
    }

    // Number constraints
    if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        throw new ValidationError(`Number too small at ${path}: minimum ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        throw new ValidationError(`Number too large at ${path}: maximum ${schema.maximum}`);
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        throw new ValidationError(`Expected integer at ${path}`);
      }
    }
  }

  /**
   * Get value type
   */
  private getValueType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
    return typeof value;
  }

  /**
   * Check if types match
   */
  private isTypeMatch(actual: string, expected: string): boolean {
    if (actual === expected) return true;
    if (expected === 'number' && actual === 'integer') return true;
    return false;
  }

  /**
   * Update tool stats
   */
  private updateStats(name: string, success: boolean, cacheHit: boolean, duration: number): void {
    const stats = this.stats.get(name);
    if (!stats) return;

    stats.totalCalls++;
    if (success) stats.successfulCalls++;
    else stats.failedCalls++;
    if (cacheHit) stats.cacheHits++;
    else stats.cacheMisses++;

    // Update average duration
    stats.averageDuration = 
      (stats.averageDuration * (stats.totalCalls - 1) + duration) / stats.totalCalls;
  }

  /**
   * Get cache key
   */
  private getCacheKey(name: string, params: Record<string, unknown>): string {
    return `${name}:${JSON.stringify(params)}`;
  }
}

// ============================================================================
// Built-in Tools
// ============================================================================

/**
 * Create default built-in tools
 */
export function createBuiltinTools(): Map<string, { definition: ToolDefinition; handler: ToolHandler }> {
  const tools = new Map();

  // Echo tool
  tools.set('echo', {
    definition: {
      name: 'echo',
      description: 'Echo back the input message',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to echo back',
          },
        },
        required: ['message'],
      },
    },
    handler: async (params: Record<string, unknown>) => ({
      success: true,
      output: params.message,
    }),
  });

  // Get time tool
  tools.set('get_time', {
    definition: {
      name: 'get_time',
      description: 'Get the current date and time',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone (e.g., "UTC", "America/New_York")',
          },
          format: {
            type: 'string',
            description: 'Output format (iso, locale, unix)',
            enum: ['iso', 'locale', 'unix'],
          },
        },
      },
    },
    handler: async (params: Record<string, unknown>) => {
      const now = new Date();
      const format = (params.format as string) || 'iso';
      const timezone = (params.timezone as string) || 'UTC';

      let output: string;
      switch (format) {
        case 'unix':
          output = Math.floor(now.getTime() / 1000).toString();
          break;
        case 'locale':
          output = now.toLocaleString('en-US', { timeZone: timezone });
          break;
        default:
          output = now.toISOString();
      }

      return { success: true, output };
    },
  });

  // Sleep tool
  tools.set('sleep', {
    definition: {
      name: 'sleep',
      description: 'Pause execution for a specified duration',
      parameters: {
        type: 'object',
        properties: {
          seconds: {
            type: 'number',
            description: 'Number of seconds to sleep',
            minimum: 0,
            maximum: 60,
          },
        },
        required: ['seconds'],
      },
      timeout: 65000,
    },
    handler: async (params: Record<string, unknown>, context: Record<string, unknown>) => {
      const seconds = params.seconds as number;
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      return { success: true, output: `Slept for ${seconds} seconds` };
    },
  });

  // Generate UUID tool
  tools.set('generate_uuid', {
    definition: {
      name: 'generate_uuid',
      description: 'Generate a random UUID',
      parameters: {
        type: 'object',
        properties: {
          version: {
            type: 'string',
            description: 'UUID version (v4)',
            enum: ['v4'],
          },
        },
      },
    },
    handler: async () => ({
      success: true,
      output: crypto.randomUUID(),
    }),
  });

  // JSON parse tool
  tools.set('json_parse', {
    definition: {
      name: 'json_parse',
      description: 'Parse a JSON string',
      parameters: {
        type: 'object',
        properties: {
          json: {
            type: 'string',
            description: 'JSON string to parse',
          },
        },
        required: ['json'],
      },
    },
    handler: async (params: Record<string, unknown>) => {
      try {
        const parsed = JSON.parse(params.json as string);
        return { success: true, output: parsed };
      } catch (error) {
        return { success: false, output: null, error: (error as Error).message };
      }
    },
  });

  // JSON stringify tool
  tools.set('json_stringify', {
    definition: {
      name: 'json_stringify',
      description: 'Convert an object to JSON string',
      parameters: {
        type: 'object',
        properties: {
          object: {
            description: 'Object to stringify',
          },
          pretty: {
            type: 'boolean',
            description: 'Pretty print the JSON',
          },
        },
        required: ['object'],
      },
    },
    handler: async (params: Record<string, unknown>) => {
      try {
        const pretty = params.pretty as boolean;
        const output = pretty 
          ? JSON.stringify(params.object, null, 2)
          : JSON.stringify(params.object);
        return { success: true, output };
      } catch (error) {
        return { success: false, output: null, error: (error as Error).message };
      }
    },
  });

  // Base64 encode tool
  tools.set('base64_encode', {
    definition: {
      name: 'base64_encode',
      description: 'Encode a string to base64',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to encode',
          },
        },
        required: ['text'],
      },
    },
    handler: async (params: Record<string, unknown>) => ({
      success: true,
      output: Buffer.from(params.text as string).toString('base64'),
    }),
  });

  // Base64 decode tool
  tools.set('base64_decode', {
    definition: {
      name: 'base64_decode',
      description: 'Decode a base64 string',
      parameters: {
        type: 'object',
        properties: {
          encoded: {
            type: 'string',
            description: 'Base64 encoded string',
          },
        },
        required: ['encoded'],
      },
    },
    handler: async (params: Record<string, unknown>) => {
      try {
        const decoded = Buffer.from(params.encoded as string, 'base64').toString('utf-8');
        return { success: true, output: decoded };
      } catch (error) {
        return { success: false, output: null, error: 'Invalid base64 string' };
      }
    },
  });

  // Hash tool
  tools.set('hash', {
    definition: {
      name: 'hash',
      description: 'Generate a hash of a string',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to hash',
          },
          algorithm: {
            type: 'string',
            description: 'Hash algorithm',
            enum: ['md5', 'sha1', 'sha256', 'sha512'],
          },
        },
        required: ['text'],
      },
    },
    handler: async (params: Record<string, unknown>) => {
      const algorithm = (params.algorithm as string) || 'sha256';
      const hash = crypto
        .createHash(algorithm)
        .update(params.text as string)
        .digest('hex');
      return { success: true, output: hash };
    },
  });

  return tools;
}

/**
 * Register built-in tools
 */
export function registerBuiltinTools(manager: ToolsManager): void {
  const tools = createBuiltinTools();

  for (const [name, { definition, handler }] of tools) {
    manager.register(definition, handler, { category: 'builtin' });
  }
}

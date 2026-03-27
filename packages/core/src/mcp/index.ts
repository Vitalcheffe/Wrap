/**
 * WRAP NEBULA v2.0 - MCP Server
 * Model Context Protocol 2.0 implementation
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import {
  MCPServerConfig,
  MCPCapabilities,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPRequest,
  MCPResponse,
  JSONSchema,
} from '../types';

// ============================================================================
// Types
// ============================================================================

interface MCPClient {
  id: string;
  initialized: boolean;
  capabilities: Record<string, unknown>;
}

interface MCPToolHandler {
  (args: Record<string, unknown>): Promise<unknown>;
}

// ============================================================================
// MCP Server Implementation
// ============================================================================

export class MCPServer extends EventEmitter {
  private config: MCPServerConfig;
  private clients: Map<string, MCPClient> = new Map();
  private tools: Map<string, { definition: MCPTool; handler: MCPToolHandler }> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private prompts: Map<string, MCPPrompt> = new Map();
  private running: boolean = false;

  constructor(config: Partial<MCPServerConfig> = {}) {
    super();
    this.config = {
      name: config.name || 'wrap-nebula-mcp',
      version: config.version || '2.0.0',
      capabilities: config.capabilities || {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        logging: {},
      },
      tools: config.tools || [],
      resources: config.resources || [],
      prompts: config.prompts || [],
    };

    // Register initial tools
    for (const tool of this.config.tools) {
      this.tools.set(tool.name, { definition: tool, handler: async () => null });
    }

    // Register initial resources
    for (const resource of this.config.resources) {
      this.resources.set(resource.uri, resource);
    }

    // Register initial prompts
    for (const prompt of this.config.prompts) {
      this.prompts.set(prompt.name, prompt);
    }
  }

  /**
   * Start the MCP server
   */
  async start(port: number = 5000): Promise<void> {
    this.running = true;
    this.emit('started', { port });
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    this.running = false;
    this.clients.clear();
    this.emit('stopped');
  }

  /**
   * Handle MCP request
   */
  async handleRequest(request: MCPRequest, clientId: string): Promise<MCPResponse> {
    const client = this.clients.get(clientId);

    try {
      const result = await this.routeRequest(request, client);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      const mcpError = {
        code: this.getErrorCode(error),
        message: (error as Error).message,
      };
      return { jsonrpc: '2.0', id: request.id, error: mcpError };
    }
  }

  /**
   * Route request to appropriate handler
   */
  private async routeRequest(request: MCPRequest, client?: MCPClient): Promise<unknown> {
    const method = request.method;
    const params = request.params || {};

    switch (method) {
      case 'initialize':
        return this.handleInitialize(params, client);

      case 'initialized':
        return this.handleInitialized(params, client);

      case 'shutdown':
        return this.handleShutdown();

      case 'tools/list':
        return this.handleToolsList();

      case 'tools/call':
        return this.handleToolsCall(params);

      case 'resources/list':
        return this.handleResourcesList();

      case 'resources/read':
        return this.handleResourcesRead(params);

      case 'resources/subscribe':
        return this.handleResourcesSubscribe(params, client);

      case 'prompts/list':
        return this.handlePromptsList();

      case 'prompts/get':
        return this.handlePromptsGet(params);

      case 'logging/setLevel':
        return this.handleLoggingSetLevel(params);

      case 'ping':
        return this.handlePing();

      default:
        throw new MCPMethodNotFoundError(`Method not found: ${method}`);
    }
  }

  // ==========================================================================
  // Request Handlers
  // ==========================================================================

  /**
   * Handle initialize request
   */
  private handleInitialize(params: Record<string, unknown>, client?: MCPClient): unknown {
    const clientId = crypto.randomUUID();
    
    this.clients.set(clientId, {
      id: clientId,
      initialized: false,
      capabilities: params.capabilities as Record<string, unknown> || {},
    });

    return {
      protocolVersion: '2024-11-05',
      capabilities: this.config.capabilities,
      serverInfo: {
        name: this.config.name,
        version: this.config.version,
      },
    };
  }

  /**
   * Handle initialized notification
   */
  private handleInitialized(params: Record<string, unknown>, client?: MCPClient): unknown {
    if (client) {
      client.initialized = true;
    }
    return {};
  }

  /**
   * Handle shutdown request
   */
  private handleShutdown(): unknown {
    return {};
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(): unknown {
    const tools = Array.from(this.tools.values()).map(t => t.definition);
    return { tools };
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(params: Record<string, unknown>): Promise<unknown> {
    const name = params.name as string;
    const arguments_ = params.arguments as Record<string, unknown> || {};

    const tool = this.tools.get(name);
    if (!tool) {
      throw new _MCPError(`Tool not found: ${name}`, -32602);
    }

    try {
      const result = await tool.handler(arguments_);
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle resources/list request
   */
  private handleResourcesList(): unknown {
    const resources = Array.from(this.resources.values());
    return { resources };
  }

  /**
   * Handle resources/read request
   */
  private handleResourcesRead(params: Record<string, unknown>): unknown {
    const uri = params.uri as string;
    const resource = this.resources.get(uri);

    if (!resource) {
      throw new _MCPError(`Resource not found: ${uri}`, -32602);
    }

    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: `Content of ${resource.name}`,
        },
      ],
    };
  }

  /**
   * Handle resources/subscribe request
   */
  private handleResourcesSubscribe(params: Record<string, unknown>, client?: MCPClient): unknown {
    return { subscribed: true };
  }

  /**
   * Handle prompts/list request
   */
  private handlePromptsList(): unknown {
    const prompts = Array.from(this.prompts.values());
    return { prompts };
  }

  /**
   * Handle prompts/get request
   */
  private handlePromptsGet(params: Record<string, unknown>): unknown {
    const name = params.name as string;
    const prompt = this.prompts.get(name);

    if (!prompt) {
      throw new _MCPError(`Prompt not found: ${name}`, -32602);
    }

    return {
      description: prompt.description,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Prompt: ${name}` },
        },
      ],
    };
  }

  /**
   * Handle logging/setLevel request
   */
  private handleLoggingSetLevel(params: Record<string, unknown>): unknown {
    return {};
  }

  /**
   * Handle ping request
   */
  private handlePing(): unknown {
    return {};
  }

  // ==========================================================================
  // Tool Registration
  // ==========================================================================

  /**
   * Register a tool
   */
  registerTool(name: string, definition: MCPTool, handler: MCPToolHandler): void {
    this.tools.set(name, { definition, handler });
    this.emit('toolRegistered', { name });
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    const result = this.tools.delete(name);
    if (result) {
      this.emit('toolUnregistered', { name });
    }
    return result;
  }

  /**
   * Register a resource
   */
  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
    this.emit('resourceRegistered', { uri: resource.uri });
  }

  /**
   * Unregister a resource
   */
  unregisterResource(uri: string): boolean {
    const result = this.resources.delete(uri);
    if (result) {
      this.emit('resourceUnregistered', { uri });
    }
    return result;
  }

  /**
   * Register a prompt
   */
  registerPrompt(prompt: MCPPrompt): void {
    this.prompts.set(prompt.name, prompt);
    this.emit('promptRegistered', { name: prompt.name });
  }

  /**
   * Unregister a prompt
   */
  unregisterPrompt(name: string): boolean {
    const result = this.prompts.delete(name);
    if (result) {
      this.emit('promptUnregistered', { name });
    }
    return result;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private getErrorCode(error: unknown): number {
    if (error instanceof _MCPError) return error.code;
    if (error instanceof MCPMethodNotFoundError) return -32601;
    if (error instanceof MCPInvalidParamsError) return -32602;
    return -32603; // Internal error
  }
}

// ============================================================================
// Error Classes
// ============================================================================

class _MCPError extends Error {
  constructor(message: string, public code: number) {
    super(message);
  }
}

class MCPMethodNotFoundError extends Error {
  code = -32601;
}

class MCPInvalidParamsError extends Error {
  code = -32602;
}

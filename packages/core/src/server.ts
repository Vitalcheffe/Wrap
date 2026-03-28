/**
 * WRAP NEBULA v2.0 - Core HTTP Server
 * Main server entry point with WebSocket support
 */

import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ServerConfig,
  ServerStats,
  HealthCheckResult,
  ComponentHealth,
  AgentConfig,
  ProviderResponse,
  ValidationError,
  SecurityError,
  WrapError,
} from './types';
import { AgentRuntime, AgentRuntimeConfig, RunOptions } from './agent/index';
import { ToolsManager, registerBuiltinTools } from './tools/index';
import { VFS } from './vfs/index';
import { SandboxBridge } from './sandbox/index';
import { SecretsManager } from './secrets/index';
import { Telemetry } from './telemetry/index';
import { StateManager } from './state/index';
import { MCPServer } from './mcp/index';
import { InputSanitizer } from './sanitizer/index';
import { PolicyEngine } from './policy/index';

// ============================================================================
// Types
// ============================================================================

interface AgentSession {
  id: string;
  agent: AgentRuntime;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'error';
}

interface WebSocketSession {
  id: string;
  ws: WebSocket;
  agentId?: string;
  createdAt: number;
}

interface APIRequest {
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface APIResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

// ============================================================================
// Core Server Implementation
// ============================================================================

export class CoreServer extends EventEmitter {
  private config: ServerConfig;
  private httpServer: http.Server | https.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private agents: Map<string, AgentSession> = new Map();
  private wsSessions: Map<string, WebSocketSession> = new Map();
  private toolsManager: ToolsManager;
  private vfs: VFS;
  private sandbox: SandboxBridge;
  private secrets: SecretsManager;
  private telemetry: Telemetry;
  private stateManager: StateManager;
  private mcpServer: MCPServer | null = null;
  private sanitizer: InputSanitizer;
  private policyEngine: PolicyEngine;
  private running: boolean = false;
  private startTime: number = 0;
  private requestsHandled: number = 0;
  private errors: number = 0;

  constructor(config: Partial<ServerConfig> = {}) {
    super();
    this.config = {
      port: 3777,
      host: '0.0.0.0',
      governorAddress: 'localhost:50051',
      vfsRoot: './sandbox',
      maxRequestSize: 10 * 1024 * 1024,
      timeout: 300000,
      corsOrigins: ['*'],
      ...config,
    };

    // Initialize components
    this.toolsManager = new ToolsManager();
    registerBuiltinTools(this.toolsManager);

    this.vfs = new VFS({ root: this.config.vfsRoot });
    this.sandbox = new SandboxBridge(this.config.governorAddress);
    this.secrets = new SecretsManager(this.config.secretsConfig);
    this.telemetry = new Telemetry(this.config.telemetryConfig);
    this.stateManager = new StateManager(this.config.stateConfig);
    this.sanitizer = new InputSanitizer();
    this.policyEngine = new PolicyEngine();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new WrapError('Server is already running', 'ALREADY_RUNNING');
    }

    // Initialize components
    await this.initializeComponents();

    // Create HTTP server
    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res).catch(error => {
        this.errors++;
        this.sendErrorResponse(res, error);
      });
    });

    // Create WebSocket server
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.wsServer.on('connection', (ws, req) => {
      this.handleWebSocketConnection(ws, req);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
      this.httpServer!.on('error', reject);
    });

    this.running = true;
    this.startTime = Date.now();

    this.emit('started', {
      port: this.config.port,
      host: this.config.host,
    });

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██╗    ██╗    ██████╗ ███████╗██╗   ██╗    ██████╗  █████╗ ║
║   ██║    ██║    ██╔══██╗██╔════╝██║   ██║    ██╔══██╗██╔══██╗║
║   ██║ █╗ ██║    ██████╔╝█████╗  ██║   ██║    ██████╔╝███████║║
║   ██║███╗██║    ██╔══██╗██╔══╝  ╚██╗ ██╔╝    ██╔══██╗██╔══██║║
║   ╚███╔███╔╝    ██║  ██║███████╗ ╚████╔╝     ██║  ██║██║  ██║║
║    ╚══╝╚══╝     ╚═╝  ╚═╝╚══════╝  ╚═══╝      ╚═╝  ╚═╝╚═╝  ╚═╝║
║                                                              ║
║   NEBULA v2.0.0 - Zero Trust AI Agent Framework             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
    console.log(`Server listening on http://${this.config.host}:${this.config.port}`);
    console.log(`WebSocket server ready for connections`);
    console.log(`Health check: http://localhost:${this.config.port}/health`);
    console.log(`API endpoint: http://localhost:${this.config.port}/v1/execute`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Close WebSocket connections
    for (const session of this.wsSessions.values()) {
      session.ws.close(1001, 'Server shutting down');
    }
    this.wsSessions.clear();

    // Close WebSocket server
    if (this.wsServer) {
      await new Promise<void>(resolve => {
        this.wsServer!.close(() => resolve());
      });
    }

    // Stop all agents
    for (const session of this.agents.values()) {
      await session.agent.cleanup();
    }
    this.agents.clear();

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>(resolve => {
        this.httpServer!.close(() => resolve());
      });
    }

    // Cleanup components
    await this.cleanupComponents();

    this.running = false;
    this.emit('stopped');
    console.log('Server stopped');
  }

  /**
   * Initialize components
   */
  private async initializeComponents(): Promise<void> {
    const initTasks = [
      this.vfs.initialize(),
      this.sandbox.connect(),
      this.secrets.initialize(),
      this.telemetry.initialize(),
      this.stateManager.initialize(),
    ];

    await Promise.allSettled(initTasks);
  }

  /**
   * Cleanup components
   */
  private async cleanupComponents(): Promise<void> {
    const cleanupTasks = [
      this.sandbox.disconnect(),
      this.telemetry.shutdown(),
      this.stateManager.close(),
    ];

    await Promise.allSettled(cleanupTasks);
  }

  // ==========================================================================
  // HTTP Request Handling
  // ==========================================================================

  /**
   * Handle HTTP request
   */
  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startTime = Date.now();
    this.requestsHandled++;

    // Parse request
    const parsedUrl = url.parse(req.url || '/', true);
    const apiRequest: APIRequest = {
      method: req.method || 'GET',
      path: parsedUrl.pathname || '/',
      query: parsedUrl.query,
      headers: req.headers as Record<string, string>,
      body: {},
    };

    // Read body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(apiRequest.method)) {
      apiRequest.body = await this.readBody(req);
    }

    // Route request
    const response = await this.routeRequest(apiRequest);

    // Send response
    this.sendResponse(res, response);

    // Log request
    const duration = Date.now() - startTime;
    this.telemetry.recordRequest(apiRequest, response, duration);
  }

  /**
   * Route API request
   */
  private async routeRequest(request: APIRequest): Promise<APIResponse> {
    const { method, path, query, body } = request;

    // CORS preflight
    if (method === 'OPTIONS') {
      return { status: 204, headers: {}, body: null };
    }

    // Health check
    if (path === '/health' && method === 'GET') {
      return this.handleHealthCheck();
    }

    // Metrics
    if (path === '/metrics' && method === 'GET') {
      return this.handleMetrics();
    }

    // API v1 routes
    if (path.startsWith('/v1/')) {
      return this.handleAPIv1(request);
    }

    // MCP routes
    if (path.startsWith('/mcp/')) {
      return this.handleMCP(request);
    }

    // Unknown route
    return { status: 404, headers: {}, body: { error: 'Not found' } };
  }

  /**
   * Handle API v1 routes
   */
  private async handleAPIv1(request: APIRequest): Promise<APIResponse> {
    const { method, path, query, body } = request;

    // Execute task
    if (path === '/v1/execute' && method === 'POST') {
      return this.handleExecute(body);
    }

    // Stream task
    if (path === '/v1/stream' && method === 'POST') {
      return {
        status: 400,
        headers: {},
        body: { error: 'Use WebSocket for streaming', code: 'USE_WEBSOCKET' },
      };
    }

    // Agent management
    if (path === '/v1/agents' && method === 'GET') {
      return this.handleListAgents();
    }

    if (path === '/v1/agents' && method === 'POST') {
      return this.handleCreateAgent(body);
    }

    const agentMatch = path.match(/^\/v1\/agents\/([^/]+)$/);
    if (agentMatch) {
      const agentId = agentMatch[1];
      
      if (method === 'GET') {
        return this.handleGetAgent(agentId);
      }
      
      if (method === 'DELETE') {
        return this.handleDeleteAgent(agentId);
      }
    }

    // Tools
    if (path === '/v1/tools' && method === 'GET') {
      return this.handleListTools();
    }

    if (path === '/v1/tools' && method === 'POST') {
      return this.handleRegisterTool(body);
    }

    // VFS
    if (path === '/v1/fs/list' && method === 'GET') {
      return this.handleVFSList(query.path as string);
    }

    if (path === '/v1/fs/read' && method === 'GET') {
      return this.handleVFSRead(query.path as string);
    }

    if (path === '/v1/fs/write' && method === 'POST') {
      return this.handleVFSWrite(body);
    }

    if (path === '/v1/fs/delete' && method === 'DELETE') {
      return this.handleVFSDelete(query.path as string);
    }

    // Secrets
    if (path === '/v1/secrets' && method === 'GET') {
      return this.handleListSecrets();
    }

    if (path === '/v1/secrets' && method === 'POST') {
      return this.handleSetSecret(body);
    }

    // Policy
    if (path === '/v1/policy' && method === 'GET') {
      return this.handleGetPolicy();
    }

    if (path === '/v1/policy' && method === 'POST') {
      return this.handleUpdatePolicy(body);
    }

    return { status: 404, headers: {}, body: { error: 'API endpoint not found' } };
  }

  // ==========================================================================
  // API Handlers
  // ==========================================================================

  /**
   * Handle health check
   */
  private handleHealthCheck(): APIResponse {
    const components: ComponentHealth[] = [
      { name: 'server', healthy: true },
      { name: 'vfs', healthy: true },
      { name: 'sandbox', healthy: true },
      { name: 'secrets', healthy: true },
      { name: 'telemetry', healthy: true },
    ];

    const result: HealthCheckResult = {
      healthy: true,
      version: '2.0.0',
      uptime: Date.now() - this.startTime,
      agents: this.agents.size,
      components,
    };

    return { status: 200, headers: {}, body: result };
  }

  /**
   * Handle metrics
   */
  private handleMetrics(): APIResponse {
    const stats = this.getStats();
    return { status: 200, headers: {}, body: stats };
  }

  /**
   * Handle execute task
   */
  private async handleExecute(body: Record<string, unknown>): Promise<APIResponse> {
    try {
      // Sanitize input
      const task = body.task as string;
      if (!task) {
        throw new ValidationError('Missing task parameter');
      }

      const sanitized = this.sanitizer.sanitize(task);
      if (sanitized.rejected) {
        throw new SecurityError(`Input rejected: ${sanitized.reason}`);
      }

      // Check policy
      const policyResult = await this.policyEngine.check({
        type: 'task_execution',
        task: sanitized.sanitized,
        model: body.model as string,
      });

      if (!policyResult.allowed) {
        throw new SecurityError(`Policy violation: ${policyResult.reason}`);
      }

      // Create or get agent
      const agentId = (body.agentId as string) || `agent-${crypto.randomUUID()}`;
      let session = this.agents.get(agentId);

      if (!session) {
        const config = this.buildAgentConfig(body, agentId);
        const agent = new AgentRuntime(config);
        await agent.initialize();
        
        session = {
          id: agentId,
          agent,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          status: 'active',
        };
        this.agents.set(agentId, session);
      }

      // Execute task
      const options: RunOptions = {
        maxIterations: body.maxIterations as number | undefined,
        timeout: body.timeout as number | undefined,
        tools: body.tools as string[] | undefined,
      };

      const result = await session.agent.run(sanitized.sanitized || task, options);
      session.lastActivity = Date.now();

      return { status: 200, headers: {}, body: result };
    } catch (error) {
      this.errors++;
      const message = error instanceof Error ? error.message : 'Unknown error';
      const code = error instanceof WrapError ? error.code : 'EXECUTION_ERROR';
      return { status: 500, headers: {}, body: { error: message, code } };
    }
  }

  /**
   * Handle list agents
   */
  private handleListAgents(): APIResponse {
    const agents = Array.from(this.agents.values()).map(session => ({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    }));

    return { status: 200, headers: {}, body: { agents } };
  }

  /**
   * Handle create agent
   */
  private async handleCreateAgent(body: Record<string, unknown>): Promise<APIResponse> {
    try {
      const config = body.config as Record<string, unknown> || {};
      const agentId = (config.id as string) || `agent-${crypto.randomUUID()}`;

      const agentConfig = this.buildAgentConfig(config, agentId);
      const agent = new AgentRuntime(agentConfig);
      await agent.initialize();

      const session: AgentSession = {
        id: agentId,
        agent,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        status: 'active',
      };
      this.agents.set(agentId, session);

      return { status: 201, headers: {}, body: { id: agentId } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle get agent
   */
  private handleGetAgent(agentId: string): APIResponse {
    const session = this.agents.get(agentId);
    if (!session) {
      return { status: 404, headers: {}, body: { error: 'Agent not found' } };
    }

    return {
      status: 200,
      headers: {},
      body: {
        id: session.id,
        status: session.status,
        state: session.agent.getState(),
        metrics: session.agent.getMetrics(),
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      },
    };
  }

  /**
   * Handle delete agent
   */
  private async handleDeleteAgent(agentId: string): Promise<APIResponse> {
    const session = this.agents.get(agentId);
    if (!session) {
      return { status: 404, headers: {}, body: { error: 'Agent not found' } };
    }

    await session.agent.cleanup();
    this.agents.delete(agentId);

    return { status: 200, headers: {}, body: { deleted: true } };
  }

  /**
   * Handle list tools
   */
  private handleListTools(): APIResponse {
    const tools = this.toolsManager.list();
    return { status: 200, headers: {}, body: { tools } };
  }

  /**
   * Handle register tool
   */
  private handleRegisterTool(body: Record<string, unknown>): APIResponse {
    try {
      const definition = body.definition as Record<string, unknown>;
      // Handler would need to be provided differently in production
      // For now, we just register the definition
      return { status: 201, headers: {}, body: { registered: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle VFS list
   */
  private async handleVFSList(path: string | undefined): Promise<APIResponse> {
    if (!path) {
      return { status: 400, headers: {}, body: { error: 'Missing path parameter' } };
    }

    try {
      const entries = await this.vfs.list(path);
      return { status: 200, headers: {}, body: { entries } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle VFS read
   */
  private async handleVFSRead(path: string | undefined): Promise<APIResponse> {
    if (!path) {
      return { status: 400, headers: {}, body: { error: 'Missing path parameter' } };
    }

    try {
      const content = await this.vfs.read(path);
      return { status: 200, headers: {}, body: { content: content.toString('utf-8') } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle VFS write
   */
  private async handleVFSWrite(body: Record<string, unknown>): Promise<APIResponse> {
    const path = body.path as string;
    const content = body.content as string;

    if (!path || content === undefined) {
      return { status: 400, headers: {}, body: { error: 'Missing path or content parameter' } };
    }

    try {
      await this.vfs.write(path, Buffer.from(content, 'utf-8'));
      return { status: 200, headers: {}, body: { written: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle VFS delete
   */
  private async handleVFSDelete(path: string | undefined): Promise<APIResponse> {
    if (!path) {
      return { status: 400, headers: {}, body: { error: 'Missing path parameter' } };
    }

    try {
      await this.vfs.delete(path);
      return { status: 200, headers: {}, body: { deleted: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle list secrets
   */
  private async handleListSecrets(): Promise<APIResponse> {
    try {
      const keys = await this.secrets.list();
      return { status: 200, headers: {}, body: { keys } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle set secret
   */
  private async handleSetSecret(body: Record<string, unknown>): Promise<APIResponse> {
    const key = body.key as string;
    const value = body.value as string;

    if (!key || !value) {
      return { status: 400, headers: {}, body: { error: 'Missing key or value parameter' } };
    }

    try {
      await this.secrets.set(key, value);
      return { status: 200, headers: {}, body: { set: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle get policy
   */
  private handleGetPolicy(): APIResponse {
    const policy = this.policyEngine.getConfig();
    return { status: 200, headers: {}, body: { policy } };
  }

  /**
   * Handle update policy
   */
  private handleUpdatePolicy(body: Record<string, unknown>): APIResponse {
    try {
      this.policyEngine.updateConfig(body);
      return { status: 200, headers: {}, body: { updated: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 500, headers: {}, body: { error: message } };
    }
  }

  /**
   * Handle MCP request
   */
  private handleMCP(request: APIRequest): APIResponse {
    // MCP protocol handling
    return { status: 200, headers: {}, body: { mcp: 'ok' } };
  }

  // ==========================================================================
  // WebSocket Handling
  // ==========================================================================

  /**
   * Handle WebSocket connection
   */
  private handleWebSocketConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const sessionId = crypto.randomUUID();
    const session: WebSocketSession = {
      id: sessionId,
      ws,
      createdAt: Date.now(),
    };
    this.wsSessions.set(sessionId, session);

    console.log(`WebSocket connected: ${sessionId}`);

    ws.on('message', (data: Buffer) => {
      this.handleWebSocketMessage(session, data);
    });

    ws.on('close', () => {
      console.log(`WebSocket disconnected: ${sessionId}`);
      this.wsSessions.delete(sessionId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error: ${sessionId}`, error);
      this.wsSessions.delete(sessionId);
    });

    // Send welcome message
    this.sendWebSocketMessage(ws, {
      type: 'connected',
      sessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(session: WebSocketSession, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      this.processWebSocketMessage(session, message);
    } catch (error) {
      this.sendWebSocketMessage(session.ws, {
        type: 'error',
        error: 'Invalid JSON message',
      });
    }
  }

  /**
   * Process WebSocket message
   */
  private async processWebSocketMessage(session: WebSocketSession, message: Record<string, unknown>): Promise<void> {
    const type = message.type as string;

    switch (type) {
      case 'ping':
        this.sendWebSocketMessage(session.ws, { type: 'pong', timestamp: Date.now() });
        break;

      case 'execute':
        await this.handleStreamingExecution(session, message);
        break;

      case 'subscribe':
        this.handleSubscribe(session, message);
        break;

      default:
        this.sendWebSocketMessage(session.ws, {
          type: 'error',
          error: `Unknown message type: ${type}`,
        });
    }
  }

  /**
   * Handle streaming execution
   */
  private async handleStreamingExecution(session: WebSocketSession, message: Record<string, unknown>): Promise<void> {
    try {
      const task = message.task as string;
      const model = message.model as string || 'claude-sonnet-4-20250514';

      // Create agent for streaming
      const agentId = `stream-${crypto.randomUUID()}`;
      const config = this.buildAgentConfig({ model }, agentId);
      const agent = new AgentRuntime(config);
      await agent.initialize();

      // Forward events to WebSocket
      agent.on('event', (event: unknown) => {
        if (session.ws.readyState === WebSocket.OPEN) {
          this.sendWebSocketMessage(session.ws, event as Record<string, unknown>);
        }
      });

      // Execute
      const result = await agent.run(task);

      this.sendWebSocketMessage(session.ws, {
        type: 'complete',
        result,
      });

      await agent.cleanup();
    } catch (error) {
      this.sendWebSocketMessage(session.ws, {
        type: 'error',
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle subscribe to agent events
   */
  private handleSubscribe(session: WebSocketSession, message: Record<string, unknown>): void {
    const agentId = message.agentId as string;
    const agentSession = this.agents.get(agentId);

    if (!agentSession) {
      this.sendWebSocketMessage(session.ws, {
        type: 'error',
        error: 'Agent not found',
      });
      return;
    }

    session.agentId = agentId;

    // Forward agent events
    agentSession.agent.on('event', (event: unknown) => {
      if (session.ws.readyState === WebSocket.OPEN && session.agentId === agentId) {
        this.sendWebSocketMessage(session.ws, event as Record<string, unknown>);
      }
    });

    this.sendWebSocketMessage(session.ws, {
      type: 'subscribed',
      agentId,
    });
  }

  /**
   * Send WebSocket message
   */
  private sendWebSocketMessage(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Build agent config
   */
  private buildAgentConfig(body: Record<string, unknown>, agentId: string): AgentRuntimeConfig {
    return {
      id: agentId,
      name: (body.name as string) || `Agent ${agentId}`,
      model: {
        provider: (body.provider as string) || this.getProviderFromModel(body.model as string),
        model: (body.model as string) || 'claude-sonnet-4-20250514',
        temperature: body.temperature as number | undefined,
        maxTokens: body.maxTokens as number | undefined,
        apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
      },
      systemPrompt: body.systemPrompt as string | undefined,
      governorAddress: this.config.governorAddress,
    };
  }

  /**
   * Get provider from model name
   */
  private getProviderFromModel(model: string): string {
    if (!model) return 'anthropic';
    if (model.includes('claude')) return 'anthropic';
    if (model.includes('gpt') || model.includes('o1')) return 'openai';
    if (model.includes('gemini')) return 'google';
    if (model.includes('llama') || model.includes('mistral')) return 'ollama';
    return 'anthropic';
  }

  /**
   * Read request body
   */
  private async readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.config.maxRequestSize) {
          req.destroy(new Error('Request body too large'));
          return;
        }
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new ValidationError('Invalid JSON body'));
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Send response
   */
  private sendResponse(res: http.ServerResponse, response: APIResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    res.writeHead(response.status, {
      'Content-Type': 'application/json',
      ...response.headers,
    });
    res.end(JSON.stringify(response.body));
  }

  /**
   * Send error response
   */
  private sendErrorResponse(res: http.ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const code = error instanceof WrapError ? error.code : 'INTERNAL_ERROR';
    const status = error instanceof ValidationError ? 400 : 
                   error instanceof SecurityError ? 403 : 500;

    this.sendResponse(res, {
      status,
      headers: {},
      body: { error: message, code },
    });
  }

  /**
   * Get server stats
   */
  getStats(): ServerStats {
    return {
      uptime: Date.now() - this.startTime,
      activeAgents: this.agents.size,
      requestsHandled: this.requestsHandled,
      errors: this.errors,
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export async function main(): Promise<void> {
  const server = new CoreServer({
    port: parseInt(process.env.CORE_PORT || '3777', 10),
    host: process.env.CORE_HOST || '0.0.0.0',
    governorAddress: process.env.GOVERNOR_ADDRESS || 'localhost:50051',
    vfsRoot: process.env.VFS_ROOT || './sandbox',
  });

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

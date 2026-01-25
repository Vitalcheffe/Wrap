/**
 * @fileoverview Main client classes for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/client
 * @description This module contains the main WRAP and WRAPClient classes that provide
 * the primary interface for interacting with the WRAP Nebula platform. It includes
 * WebSocket connection handling, retry logic, error handling, and full API coverage.
 */

import EventEmitter from 'eventemitter3';
import type {
  ClientConfig,
  ConnectionInfo,
  ConnectionState,
  WRAPEvent,
  WRAPEventType,
  EventHandler,
  SandboxConfig,
  SandboxInfo,
  AgentConfig,
  AgentResult,
  ToolDefinition,
  Permission,
  Boundaries,
  Message,
  LogLevel,
  TelemetryData,
} from './types';
import { Logger, defaultLogger, retry, sleep, generateId, deepMerge } from './utils';
import {
  WRAPError,
  ConnectionError,
  WebSocketError,
  ConfigurationError,
  TimeoutError,
  ErrorCodes,
  isRetryable,
} from './errors';

// ============================================================================
// TYPES
// ============================================================================

/**
 * WebSocket message types
 */
interface WebSocketMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

/**
 * WebSocket response
 */
interface WebSocketResponse {
  id: string;
  success: boolean;
  payload?: unknown;
  error?: {
    code: number;
    message: string;
    details?: unknown;
  };
}

/**
 * Pending request for WebSocket
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  startTime: number;
}

/**
 * Internal client state
 */
interface ClientState {
  connection: ConnectionState;
  connectionInfo: ConnectionInfo;
  reconnectAttempts: number;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  pendingRequests: Map<string, PendingRequest>;
}

// ============================================================================
// WRAP CLIENT CLASS
// ============================================================================

/**
 * Main client class for WRAP Nebula SDK
 * @description The WRAPClient class provides the primary interface for interacting
 * with the WRAP Nebula platform. It handles WebSocket connections, authentication,
 * API calls, and event management.
 * 
 * @example
 * ```typescript
 * const client = new WRAPClient({
 *   endpoint: 'https://api.wrap.dev',
 *   apiKey: 'your-api-key',
 * });
 * 
 * await client.connect();
 * const sandbox = await client.createSandbox({ ... });
 * ```
 */
export class WRAPClient extends EventEmitter {
  /** Client configuration */
  private config: Required<ClientConfig>;
  /** Logger instance */
  protected logger: Logger;
  /** WebSocket connection */
  private ws: WebSocket | null = null;
  /** Client state */
  private state: ClientState;
  /** Whether the client is destroyed */
  private destroyed = false;
  /** Default request timeout */
  private readonly defaultTimeout = 30000;

  /**
   * Creates a new WRAPClient instance
   * @param config - Client configuration
   */
  constructor(config: ClientConfig = {}) {
    super();
    
    // Validate configuration
    this.validateConfig(config);
    
    // Set default configuration
    this.config = {
      endpoint: config.endpoint ?? 'https://api.wrap.dev',
      apiKey: config.apiKey ?? '',
      timeout: config.timeout ?? 30000,
      websocket: {
        enabled: config.websocket?.enabled ?? true,
        url: config.websocket?.url,
        reconnect: config.websocket?.reconnect ?? true,
        maxReconnectAttempts: config.websocket?.maxReconnectAttempts ?? 5,
        reconnectDelay: config.websocket?.reconnectDelay ?? 1000,
        heartbeatInterval: config.websocket?.heartbeatInterval ?? 30000,
        compression: config.websocket?.compression ?? false,
      },
      retry: {
        maxAttempts: config.retry?.maxAttempts ?? 3,
        initialDelay: config.retry?.initialDelay ?? 1000,
        maxDelay: config.retry?.maxDelay ?? 10000,
        backoffMultiplier: config.retry?.backoffMultiplier ?? 2,
        jitter: config.retry?.jitter ?? true,
      },
      telemetry: {
        enabled: config.telemetry?.enabled ?? false,
        samplingRate: config.telemetry?.samplingRate ?? 1,
        exportEndpoint: config.telemetry?.exportEndpoint,
        exportInterval: config.telemetry?.exportInterval ?? 60000,
        exportHeaders: config.telemetry?.exportHeaders,
      },
      logLevel: config.logLevel ?? 'info',
      headers: config.headers ?? {},
      custom: config.custom ?? {},
    };
    
    // Initialize logger
    this.logger = new Logger({
      level: this.config.logLevel,
      prefix: '[WRAPClient]',
    });
    
    // Initialize state
    this.state = {
      connection: 'disconnected',
      connectionInfo: {
        state: 'disconnected',
      },
      reconnectAttempts: 0,
      heartbeatInterval: null,
      pendingRequests: new Map(),
    };
    
    this.logger.debug('WRAPClient initialized');
  }

  /**
   * Validates the client configuration
   * @param config - Configuration to validate
   */
  private validateConfig(config: ClientConfig): void {
    if (config.endpoint && !this.isValidUrl(config.endpoint)) {
      throw new ConfigurationError('Invalid endpoint URL', {
        configKey: 'endpoint',
        configPath: 'endpoint',
      });
    }
    
    if (config.timeout !== undefined && config.timeout < 0) {
      throw new ConfigurationError('Timeout must be non-negative', {
        configKey: 'timeout',
        configPath: 'timeout',
      });
    }
    
    if (config.websocket?.maxReconnectAttempts !== undefined && 
        config.websocket.maxReconnectAttempts < 0) {
      throw new ConfigurationError('Max reconnect attempts must be non-negative', {
        configKey: 'maxReconnectAttempts',
        configPath: 'websocket.maxReconnectAttempts',
      });
    }
  }

  /**
   * Checks if a string is a valid URL
   * @param url - URL string to check
   * @returns Whether the URL is valid
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets the WebSocket URL from the endpoint
   * @returns WebSocket URL
   */
  private getWebSocketUrl(): string {
    if (this.config.websocket.url) {
      return this.config.websocket.url;
    }
    
    const endpoint = new URL(this.config.endpoint);
    const wsProtocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${endpoint.host}/ws`;
  }

  /**
   * Connects to the WRAP platform
   * @returns Promise that resolves when connected
   */
  public async connect(): Promise<void> {
    if (this.destroyed) {
      throw new WRAPError('Client has been destroyed', {
        code: ErrorCodes.NOT_INITIALIZED,
        recoverable: false,
      });
    }
    
    if (this.state.connection === 'connected') {
      this.logger.warn('Already connected');
      return;
    }
    
    this.logger.info('Connecting to WRAP platform...');
    
    try {
      await this.connectWebSocket();
      this.state.reconnectAttempts = 0;
      this.startHeartbeat();
      this.logger.info('Connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect', error);
      throw error;
    }
  }

  /**
   * Establishes WebSocket connection
   */
  private async connectWebSocket(): Promise<void> {
    if (!this.config.websocket.enabled) {
      this.logger.debug('WebSocket disabled, skipping connection');
      this.updateConnectionState('connected');
      return;
    }
    
    return new Promise((resolve, reject) => {
      this.updateConnectionState('connecting');
      
      const wsUrl = this.getWebSocketUrl();
      this.logger.debug(`Connecting to WebSocket: ${wsUrl}`);
      
      try {
        this.ws = new WebSocket(wsUrl);
      } catch (error) {
        this.updateConnectionState('error');
        reject(new WebSocketError('Failed to create WebSocket connection', {
          endpoint: wsUrl,
          cause: error instanceof Error ? error : new Error(String(error)),
        }));
        return;
      }
      
      const timeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          this.ws.close();
          reject(new TimeoutError('WebSocket connection timeout', {
            timeoutMs: this.config.timeout,
            operation: 'connect',
          }));
        }
      }, this.config.timeout);
      
      this.ws.onopen = (): void => {
        clearTimeout(timeout);
        this.updateConnectionState('connected');
        this.state.connectionInfo = {
          state: 'connected',
          endpoint: wsUrl,
          connectedAt: new Date(),
          lastActivity: new Date(),
        };
        resolve();
      };
      
      this.ws.onerror = (event): void => {
        clearTimeout(timeout);
        this.logger.error('WebSocket error', event);
        this.updateConnectionState('error');
        
        if (this.state.connection === 'connecting') {
          reject(new WebSocketError('WebSocket connection failed', {
            endpoint: wsUrl,
          }));
        }
      };
      
      this.ws.onclose = (event): void => {
        clearTimeout(timeout);
        this.handleWebSocketClose(event);
      };
      
      this.ws.onmessage = (event): void => {
        this.handleWebSocketMessage(event);
      };
    });
  }

  /**
   * Handles WebSocket close event
   * @param event - Close event
   */
  private handleWebSocketClose(event: CloseEvent): void {
    this.logger.debug(`WebSocket closed: ${event.code} - ${event.reason}`);
    
    // Clear heartbeat
    if (this.state.heartbeatInterval) {
      clearInterval(this.state.heartbeatInterval);
      this.state.heartbeatInterval = null;
    }
    
    // Reject all pending requests
    this.rejectPendingRequests(
      new WebSocketError('Connection closed', {
        closeCode: event.code,
        closeReason: event.reason,
      })
    );
    
    // Update state
    this.updateConnectionState('disconnected');
    
    // Attempt reconnection if enabled
    if (this.config.websocket.reconnect && !this.destroyed) {
      this.attemptReconnect();
    }
  }

  /**
   * Handles WebSocket message
   * @param event - Message event
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    this.state.connectionInfo.lastActivity = new Date();
    
    try {
      const message: WebSocketMessage | WebSocketResponse = JSON.parse(event.data);
      
      if ('success' in message) {
        // This is a response to a request
        this.handleResponse(message);
      } else {
        // This is an event or notification
        this.handleEvent(message);
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message', error);
    }
  }

  /**
   * Handles a response message
   * @param response - Response message
   */
  private handleResponse(response: WebSocketResponse): void {
    const pending = this.state.pendingRequests.get(response.id);
    
    if (!pending) {
      this.logger.warn(`Received response for unknown request: ${response.id}`);
      return;
    }
    
    clearTimeout(pending.timeout);
    this.state.pendingRequests.delete(response.id);
    
    if (response.success) {
      pending.resolve(response.payload);
    } else {
      const error = new WRAPError(
        response.error?.message ?? 'Request failed',
        {
          code: response.error?.code ?? ErrorCodes.UNKNOWN,
          details: response.error?.details as Record<string, unknown>,
        }
      );
      pending.reject(error);
    }
  }

  /**
   * Handles an event message
   * @param message - Event message
   */
  private handleEvent(message: WebSocketMessage): void {
    const event: WRAPEvent = {
      type: message.type as WRAPEventType,
      id: message.id,
      timestamp: new Date(message.timestamp),
      payload: message.payload,
    };
    
    this.emit(message.type, event);
    this.emit('*', event);
  }

  /**
   * Attempts to reconnect to the WebSocket
   */
  private async attemptReconnect(): Promise<void> {
    if (this.state.reconnectAttempts >= this.config.websocket.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      this.updateConnectionState('error');
      this.emit('connection:error', {
        type: 'connection:error',
        id: generateId(),
        timestamp: new Date(),
        payload: { reason: 'max_reconnect_attempts' },
      });
      return;
    }
    
    this.updateConnectionState('reconnecting');
    this.state.reconnectAttempts++;
    
    const delay = Math.min(
      this.config.websocket.reconnectDelay * Math.pow(2, this.state.reconnectAttempts - 1),
      30000
    );
    
    this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.state.reconnectAttempts})`);
    
    await sleep(delay);
    
    try {
      await this.connectWebSocket();
      this.state.reconnectAttempts = 0;
      this.startHeartbeat();
      this.logger.info('Reconnected successfully');
    } catch (error) {
      this.logger.error('Reconnect failed', error);
      // Will attempt again via the close handler
    }
  }

  /**
   * Starts the heartbeat interval
   */
  private startHeartbeat(): void {
    if (!this.config.websocket.enabled || !this.ws) return;
    
    this.state.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendRaw('ping', {}).catch(error => {
          this.logger.error('Heartbeat failed', error);
        });
      }
    }, this.config.websocket.heartbeatInterval);
  }

  /**
   * Updates the connection state
   * @param state - New connection state
   */
  private updateConnectionState(state: ConnectionState): void {
    const previousState = this.state.connection;
    this.state.connection = state;
    this.state.connectionInfo.state = state;
    
    if (previousState !== state) {
      this.emit('connection:state_change', {
        type: 'connection:state_change',
        id: generateId(),
        timestamp: new Date(),
        payload: { previousState, currentState: state },
      });
    }
  }

  /**
   * Rejects all pending requests
   * @param error - Error to reject with
   */
  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.state.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.state.pendingRequests.clear();
  }

  /**
   * Sends a raw message over WebSocket
   * @param type - Message type
   * @param payload - Message payload
   * @returns Promise that resolves with the response
   */
  private async sendRaw<T = unknown>(type: string, payload: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('WebSocket is not connected', {
        readyState: this.ws?.readyState,
      });
    }
    
    const id = generateId();
    const message: WebSocketMessage = {
      id,
      type,
      payload,
      timestamp: Date.now(),
    };
    
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.state.pendingRequests.delete(id);
        reject(new TimeoutError(`Request timeout: ${type}`, {
          timeoutMs: this.config.timeout,
          operation: type,
        }));
      }, this.config.timeout);
      
      this.state.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        startTime: Date.now(),
      });
      
      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Sends an HTTP request
   * @template T - Response type
   * @param method - HTTP method
   * @param path - API path
   * @param body - Request body
   * @returns Response data
   */
  private async sendHttp<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = new URL(path, this.config.endpoint);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
    
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new ConnectionError(`HTTP error: ${response.status}`, {
        endpoint: url.toString(),
        statusCode: response.status,
        details: { body: error },
      });
    }
    
    if (response.status === 204) {
      return undefined as T;
    }
    
    return response.json();
  }

  // =========================================================================
  // PUBLIC API METHODS
  // =========================================================================

  /**
   * Gets the current connection state
   * @returns Connection state
   */
  public getConnectionState(): ConnectionState {
    return this.state.connection;
  }

  /**
   * Gets the connection info
   * @returns Connection info
   */
  public getConnectionInfo(): ConnectionInfo {
    return { ...this.state.connectionInfo };
  }

  /**
   * Checks if the client is connected
   * @returns Whether connected
   */
  public isConnected(): boolean {
    return this.state.connection === 'connected';
  }

  /**
   * Creates a new sandbox
   * @param config - Sandbox configuration
   * @returns Sandbox info
   */
  public async createSandbox(config: SandboxConfig): Promise<SandboxInfo> {
    this.ensureConnected();
    
    return retry(
      async () => {
        if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
          return this.sendRaw<SandboxInfo>('sandbox:create', config);
        }
        return this.sendHttp<SandboxInfo>('POST', '/api/sandboxes', config);
      },
      {
        maxAttempts: this.config.retry.maxAttempts,
        initialDelay: this.config.retry.initialDelay,
        maxDelay: this.config.retry.maxDelay,
        backoffMultiplier: this.config.retry.backoffMultiplier,
        jitter: this.config.retry.jitter,
      }
    );
  }

  /**
   * Destroys a sandbox
   * @param sandboxId - Sandbox ID
   */
  public async destroySandbox(sandboxId: string): Promise<void> {
    this.ensureConnected();
    
    return retry(
      async () => {
        if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
          await this.sendRaw('sandbox:destroy', { sandboxId });
        } else {
          await this.sendHttp('DELETE', `/api/sandboxes/${sandboxId}`);
        }
      },
      {
        maxAttempts: this.config.retry.maxAttempts,
        initialDelay: this.config.retry.initialDelay,
        maxDelay: this.config.retry.maxDelay,
        backoffMultiplier: this.config.retry.backoffMultiplier,
        jitter: this.config.retry.jitter,
      }
    );
  }

  /**
   * Gets sandbox info
   * @param sandboxId - Sandbox ID
   * @returns Sandbox info
   */
  public async getSandbox(sandboxId: string): Promise<SandboxInfo> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      return this.sendRaw<SandboxInfo>('sandbox:get', { sandboxId });
    }
    return this.sendHttp<SandboxInfo>('GET', `/api/sandboxes/${sandboxId}`);
  }

  /**
   * Lists all sandboxes
   * @returns Array of sandbox info
   */
  public async listSandboxes(): Promise<SandboxInfo[]> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      return this.sendRaw<SandboxInfo[]>('sandbox:list', {});
    }
    return this.sendHttp<SandboxInfo[]>('GET', '/api/sandboxes');
  }

  /**
   * Executes code in a sandbox
   * @param sandboxId - Sandbox ID
   * @param code - Code to execute
   * @param args - Arguments for execution
   * @returns Execution result
   */
  public async execute(
    sandboxId: string,
    code: string,
    args?: unknown[]
  ): Promise<unknown> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      return this.sendRaw('sandbox:execute', { sandboxId, code, args });
    }
    return this.sendHttp('POST', `/api/sandboxes/${sandboxId}/execute`, { code, args });
  }

  /**
   * Creates a new agent
   * @param config - Agent configuration
   * @returns Agent ID
   */
  public async createAgent(config: AgentConfig): Promise<string> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      const result = await this.sendRaw<{ agentId: string }>('agent:create', config);
      return result.agentId;
    }
    const result = await this.sendHttp<{ agentId: string }>('POST', '/api/agents', config);
    return result.agentId;
  }

  /**
   * Sends a message to an agent
   * @param agentId - Agent ID
   * @param message - Message to send
   * @returns Agent result
   */
  public async sendMessage(
    agentId: string,
    message: string | Message
  ): Promise<AgentResult> {
    this.ensureConnected();
    
    const payload = typeof message === 'string' 
      ? { agentId, message }
      : { agentId, message };
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      return this.sendRaw<AgentResult>('agent:message', payload);
    }
    return this.sendHttp<AgentResult>('POST', `/api/agents/${agentId}/message`, payload);
  }

  /**
   * Registers a tool
   * @param tool - Tool definition
   */
  public async registerTool(tool: ToolDefinition): Promise<void> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      await this.sendRaw('tool:register', tool);
    } else {
      await this.sendHttp('POST', '/api/tools', tool);
    }
  }

  /**
   * Lists available tools
   * @returns Array of tool definitions
   */
  public async listTools(): Promise<ToolDefinition[]> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      return this.sendRaw<ToolDefinition[]>('tool:list', {});
    }
    return this.sendHttp<ToolDefinition[]>('GET', '/api/tools');
  }

  /**
   * Grants permissions
   * @param sandboxId - Sandbox ID
   * @param permissions - Permissions to grant
   */
  public async grantPermissions(
    sandboxId: string,
    permissions: Permission[]
  ): Promise<void> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      await this.sendRaw('permission:grant', { sandboxId, permissions });
    } else {
      await this.sendHttp('POST', `/api/sandboxes/${sandboxId}/permissions`, { permissions });
    }
  }

  /**
   * Sets boundaries for a sandbox
   * @param sandboxId - Sandbox ID
   * @param boundaries - Boundaries to set
   */
  public async setBoundaries(
    sandboxId: string,
    boundaries: Boundaries
  ): Promise<void> {
    this.ensureConnected();
    
    if (this.config.websocket.enabled && this.ws?.readyState === WebSocket.OPEN) {
      await this.sendRaw('sandbox:setBoundaries', { sandboxId, boundaries });
    } else {
      await this.sendHttp('PUT', `/api/sandboxes/${sandboxId}/boundaries`, boundaries);
    }
  }

  /**
   * Subscribes to an event type
   * @param eventType - Event type to subscribe to
   * @param handler - Event handler
   * @returns Unsubscribe function
   */
  public subscribe<T = unknown>(
    eventType: WRAPEventType | '*',
    handler: EventHandler<T>
  ): () => void {
    const wrappedHandler = (event: WRAPEvent): void => {
      handler(event as WRAPEvent<T>);
    };
    
    this.on(eventType, wrappedHandler);
    
    return (): void => {
      this.off(eventType, wrappedHandler);
    };
  }

  /**
   * Waits for a specific event
   * @param eventType - Event type to wait for
   * @param timeout - Timeout in milliseconds
   * @returns Event payload
   */
  public async waitForEvent<T = unknown>(
    eventType: WRAPEventType,
    timeout?: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.off(eventType, handler);
        reject(new TimeoutError(`Timeout waiting for event: ${eventType}`, {
          timeoutMs: timeout ?? this.config.timeout,
        }));
      }, timeout ?? this.config.timeout);
      
      const handler = (event: WRAPEvent<T>): void => {
        clearTimeout(timeoutId);
        resolve(event.payload);
      };
      
      this.once(eventType, handler);
    });
  }

  /**
   * Ensures the client is connected
   */
  private ensureConnected(): void {
    if (this.destroyed) {
      throw new WRAPError('Client has been destroyed', {
        code: ErrorCodes.NOT_INITIALIZED,
        recoverable: false,
      });
    }
    
    if (this.state.connection !== 'connected') {
      throw new ConnectionError('Client is not connected', {
        details: { state: this.state.connection },
      });
    }
  }

  /**
   * Sets the log level
   * @param level - New log level
   */
  public setLogLevel(level: LogLevel): void {
    this.config.logLevel = level;
    this.logger.setLevel(level);
  }

  /**
   * Gets telemetry data
   * @returns Telemetry data
   */
  public getTelemetry(): TelemetryData | null {
    if (!this.config.telemetry.enabled) {
      return null;
    }
    
    return {
      traceId: generateId(),
      spanId: generateId(),
      operationName: 'client.getTelemetry',
      startTime: new Date(),
      status: 'ok',
      attributes: {
        connectionState: this.state.connection,
        reconnectAttempts: this.state.reconnectAttempts,
        pendingRequests: this.state.pendingRequests.size,
      },
    };
  }

  /**
   * Disconnects and destroys the client
   */
  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    
    this.destroyed = true;
    this.logger.info('Destroying client');
    
    // Clear heartbeat
    if (this.state.heartbeatInterval) {
      clearInterval(this.state.heartbeatInterval);
      this.state.heartbeatInterval = null;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Client destroyed');
      this.ws = null;
    }
    
    // Reject pending requests
    this.rejectPendingRequests(
      new WRAPError('Client destroyed', {
        code: ErrorCodes.OPERATION_CANCELLED,
        recoverable: false,
      })
    );
    
    // Clear all event listeners
    this.removeAllListeners();
    
    // Update state
    this.updateConnectionState('disconnected');
  }
}

// ============================================================================
// WRAP CLASS
// ============================================================================

/**
 * Main WRAP class - High-level API for WRAP Nebula SDK
 * @description The WRAP class provides a high-level API for working with the
 * WRAP Nebula platform. It wraps the WRAPClient and provides convenience methods
 * for common operations.
 * 
 * @example
 * ```typescript
 * import { WRAP } from '@wrap-nebula/js-sdk';
 * 
 * const wrap = new WRAP({ apiKey: 'your-api-key' });
 * 
 * // Create an agent
 * const agent = await wrap.agent({
 *   model: 'gpt-4',
 *   systemPrompt: 'You are a helpful assistant.',
 * });
 * 
 * const response = await agent.run('Hello!');
 * ```
 */
export class WRAP {
  /** Underlying client */
  private client: WRAPClient;
  /** Configuration */
  private config: ClientConfig;
  /** Logger instance */
  private logger: Logger;

  /**
   * Creates a new WRAP instance
   * @param config - Configuration
   */
  constructor(config: ClientConfig = {}) {
    this.config = config;
    this.client = new WRAPClient(config);
    this.logger = new Logger({
      level: config.logLevel ?? 'info',
      prefix: '[WRAP]',
    });
  }

  /**
   * Gets the underlying client
   * @returns WRAPClient instance
   */
  public getClient(): WRAPClient {
    return this.client;
  }

  /**
   * Connects to the platform
   */
  public async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnects from the platform
   */
  public async disconnect(): Promise<void> {
    await this.client.destroy();
  }

  /**
   * Creates a new sandbox
   * @param options - Sandbox options
   * @returns Sandbox instance
   */
  public async sandbox(options?: Partial<SandboxConfig>): Promise<SandboxHandle> {
    await this.ensureConnected();
    
    const config: SandboxConfig = deepMerge(
      {
        id: generateId('sandbox'),
        isolationType: 'v8',
        boundaries: this.getDefaultBoundaries(),
        permissions: [],
        timeout: 30000,
        autoDestroy: true,
      },
      options ?? {}
    );
    
    const info = await this.client.createSandbox(config);
    
    return new SandboxHandle(this.client, info);
  }

  /**
   * Creates a new agent
   * @param options - Agent options
   * @returns Agent instance
   */
  public async agent(options: Partial<AgentConfig>): Promise<AgentHandle> {
    await this.ensureConnected();
    
    const config: AgentConfig = deepMerge(
      {
        id: generateId('agent'),
        name: 'default-agent',
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4096,
        maxConversationTurns: 50,
      },
      options
    );
    
    const agentId = await this.client.createAgent(config);
    
    return new AgentHandle(this.client, agentId, config);
  }

  /**
   * Ensures the client is connected
   */
  private async ensureConnected(): Promise<void> {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }
  }

  /**
   * Gets default boundaries
   * @returns Default boundaries
   */
  private getDefaultBoundaries(): Boundaries {
    return {
      memoryLimit: 256 * 1024 * 1024, // 256MB
      cpuTimeLimit: 30000, // 30 seconds
      wallTimeLimit: 60000, // 60 seconds
      networkAccess: {
        allowed: false,
      },
      fileSystemAccess: {
        allowed: false,
      },
      processExecution: {
        allowed: false,
      },
      environmentVariables: {
        allowed: false,
      },
    };
  }
}

// ============================================================================
// SANDBOX HANDLE
// ============================================================================

/**
 * Handle for interacting with a sandbox
 */
export class SandboxHandle {
  private client: WRAPClient;
  private info: SandboxInfo;
  private destroyed = false;

  constructor(client: WRAPClient, info: SandboxInfo) {
    this.client = client;
    this.info = info;
  }

  /**
   * Gets the sandbox ID
   */
  public get id(): string {
    return this.info.id;
  }

  /**
   * Gets the sandbox info
   */
  public getInfo(): SandboxInfo {
    return { ...this.info };
  }

  /**
   * Executes code in the sandbox
   * @param code - Code to execute
   * @param args - Arguments
   * @returns Execution result
   */
  public async execute(code: string, args?: unknown[]): Promise<unknown> {
    this.ensureNotDestroyed();
    return this.client.execute(this.info.id, code, args);
  }

  /**
   * Destroys the sandbox
   */
  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    
    this.destroyed = true;
    await this.client.destroySandbox(this.info.id);
  }

  /**
   * Ensures the sandbox is not destroyed
   */
  private ensureNotDestroyed(): void {
    if (this.destroyed) {
      throw new WRAPError('Sandbox has been destroyed', {
        code: ErrorCodes.NOT_INITIALIZED,
        recoverable: false,
      });
    }
  }
}

// ============================================================================
// AGENT HANDLE
// ============================================================================

/**
 * Handle for interacting with an agent
 */
export class AgentHandle {
  private client: WRAPClient;
  private agentId: string;
  private config: AgentConfig;

  constructor(client: WRAPClient, agentId: string, config: AgentConfig) {
    this.client = client;
    this.agentId = agentId;
    this.config = config;
  }

  /**
   * Gets the agent ID
   */
  public get id(): string {
    return this.agentId;
  }

  /**
   * Runs the agent with a message
   * @param message - Message to send
   * @returns Agent result
   */
  public async run(message: string): Promise<AgentResult> {
    return this.client.sendMessage(this.agentId, message);
  }

  /**
   * Gets the agent configuration
   */
  public getConfig(): AgentConfig {
    return { ...this.config };
  }
}

export default WRAP;

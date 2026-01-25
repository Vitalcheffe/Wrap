/**
 * @fileoverview Web HTTP Client Tools Implementation
 * @description HTTP client, WebSocket, and web-related tools with rate limiting
 * @module @wrap-nebula/core/tools/web
 * @version 1.0.0
 * @author WRAP Nebula Team
 * @license MIT
 */

import type {
  Tool,
  ToolHandler,
  ToolExecutor,
  ToolExecutionContext,
  ToolResult,
  Boundaries,
  NetworkBoundary,
} from '../types';
import { ToolBuilder, checkNetworkBoundary } from './index';

// ============================================================================
// Types
// ============================================================================

/**
 * HTTP request options.
 */
interface HttpRequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  auth?: {
    type: 'basic' | 'bearer' | 'api_key';
    username?: string;
    password?: string;
    token?: string;
    header?: string;
  };
}

/**
 * HTTP response structure.
 */
interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  time: number;
  redirected: boolean;
  finalUrl: string;
}

/**
 * WebSocket connection options.
 */
interface WebSocketOptions {
  url: string;
  headers?: Record<string, string>;
  protocols?: string[];
  timeout?: number;
  maxMessages?: number;
  pingInterval?: number;
}

/**
 * WebSocket message.
 */
interface WebSocketMessage {
  type: 'text' | 'binary';
  data: string | Buffer;
  timestamp: number;
}

/**
 * WebSocket result.
 */
interface WebSocketResult {
  connected: boolean;
  messages: WebSocketMessage[];
  error?: string;
  duration: number;
}

/**
 * Rate limit configuration.
 */
interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (context: ToolExecutionContext) => string;
}

/**
 * Rate limit entry.
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * URL validation result.
 */
interface UrlValidationResult {
  valid: boolean;
  protocol?: string;
  hostname?: string;
  port?: number;
  pathname?: string;
  search?: string;
  error?: string;
}

// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Simple in-memory rate limiter.
 */
class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a request is allowed.
   */
  isAllowed(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || entry.resetAt < now) {
      // Create new entry
      this.limits.set(key, {
        count: 1,
        resetAt: now + this.config.windowMs,
      });
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt: now + this.config.windowMs,
      };
    }

    if (entry.count >= this.config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Clear expired entries.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits) {
      if (entry.resetAt < now) {
        this.limits.delete(key);
      }
    }
  }

  /**
   * Reset all limits.
   */
  reset(): void {
    this.limits.clear();
  }
}

// Global rate limiter instance
const globalRateLimiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000, // 1 minute
});

// ============================================================================
// HTTP Tools
// ============================================================================

/**
 * Create the HTTP request tool.
 */
export function createHttpRequestTool(): ToolHandler {
  return ToolBuilder.create('http_request', 'HTTP Request')
    .description('Make an HTTP request to a URL')
    .string('url', { required: true, description: 'URL to request' })
    .string('method', { default: 'GET', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], description: 'HTTP method' })
    .object('headers', {}, { description: 'Request headers' })
    .string('body', { description: 'Request body (string or JSON)' })
    .integer('timeout', { default: 30000, minimum: 1000, maximum: 120000, description: 'Timeout in milliseconds' })
    .boolean('followRedirects', { default: true, description: 'Follow HTTP redirects' })
    .integer('maxRedirects', { default: 5, minimum: 0, maximum: 10, description: 'Maximum redirects to follow' })
    .category('network')
    .tags('http', 'request', 'web', 'fetch')
    .timeout(60000)
    .executor(async (params, context) => {
      const startTime = Date.now();

      const url = params.url as string;
      const method = (params.method as string) ?? 'GET';
      const headers = (params.headers as Record<string, string>) ?? {};
      const body = params.body as string | undefined;
      const timeout = (params.timeout as number) ?? 30000;
      const followRedirects = (params.followRedirects as boolean) ?? true;
      const maxRedirects = (params.maxRedirects as number) ?? 5;

      try {
        // Check boundaries
        const boundaryCheck = checkNetworkBoundary(url, context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        // Check rate limit
        const rateLimitKey = `${context.agentId}:${url}`;
        const rateCheck = globalRateLimiter.isAllowed(rateLimitKey);
        if (!rateCheck.allowed) {
          return {
            success: false,
            error: `Rate limit exceeded. Reset at ${new Date(rateCheck.resetAt).toISOString()}`,
            errorCode: 'RATE_LIMIT',
            executionTime: Date.now() - startTime,
          };
        }

        // Make the request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const requestOptions: RequestInit = {
          method,
          headers: {
            'User-Agent': 'WRAP-Nebula/1.0',
            ...headers,
          },
          signal: controller.signal,
          redirect: followRedirects ? 'follow' : 'manual',
        };

        // Add body for methods that support it
        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
          if (!headers['Content-Type']) {
            (requestOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
          }
        }

        const response = await fetch(url, requestOptions);
        clearTimeout(timeoutId);

        // Extract response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        // Get response body
        const responseBody = await response.text();

        const result: HttpResponse = {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
          size: responseBody.length,
          time: Date.now() - startTime,
          redirected: response.redirected,
          finalUrl: response.url,
        };

        return {
          success: response.ok,
          data: result,
          error: !response.ok ? `HTTP ${response.status}: ${response.statusText}` : undefined,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'REQUEST_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the JSON request tool.
 */
export function createJsonRequestTool(): ToolHandler {
  return ToolBuilder.create('json_request', 'JSON Request')
    .description('Make an HTTP request and parse JSON response')
    .string('url', { required: true, description: 'URL to request' })
    .string('method', { default: 'GET', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method' })
    .object('headers', {}, { description: 'Request headers' })
    .object('body', {}, { description: 'Request body (will be JSON encoded)' })
    .integer('timeout', { default: 30000, minimum: 1000, maximum: 120000, description: 'Timeout in milliseconds' })
    .category('network')
    .tags('http', 'json', 'api', 'request')
    .timeout(60000)
    .executor(async (params, context) => {
      const startTime = Date.now();

      const url = params.url as string;
      const method = (params.method as string) ?? 'GET';
      const headers = (params.headers as Record<string, string>) ?? {};
      const body = params.body as Record<string, unknown> | undefined;
      const timeout = (params.timeout as number) ?? 30000;

      try {
        // Check boundaries
        const boundaryCheck = checkNetworkBoundary(url, context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const requestOptions: RequestInit = {
          method,
          headers: {
            'User-Agent': 'WRAP-Nebula/1.0',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...headers,
          },
          signal: controller.signal,
        };

        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          requestOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, requestOptions);
        clearTimeout(timeoutId);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        // Parse JSON response
        let data: unknown;
        const responseText = await response.text();
        
        try {
          data = JSON.parse(responseText);
        } catch {
          data = { raw: responseText };
        }

        return {
          success: response.ok,
          data: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data,
          },
          error: !response.ok ? `HTTP ${response.status}: ${response.statusText}` : undefined,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'REQUEST_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the URL validation tool.
 */
export function createUrlValidationTool(): ToolHandler {
  return ToolBuilder.create('url_validate', 'Validate URL')
    .description('Validate and parse a URL')
    .string('url', { required: true, description: 'URL to validate' })
    .boolean('strict', { default: true, description: 'Require http or https protocol' })
    .category('network')
    .tags('url', 'validation', 'parse')
    .timeout(5000)
    .executor(async (params, context) => {
      const startTime = Date.now();

      const url = params.url as string;
      const strict = (params.strict as boolean) ?? true;

      try {
        const parsed = new URL(url);
        const result: UrlValidationResult = {
          valid: true,
          protocol: parsed.protocol.replace(':', ''),
          hostname: parsed.hostname,
          port: parsed.port ? parseInt(parsed.port, 10) : undefined,
          pathname: parsed.pathname,
          search: parsed.search,
        };

        // Check strict protocol requirement
        if (strict && !['http', 'https'].includes(result.protocol!)) {
          return {
            success: false,
            data: {
              valid: false,
              error: `Invalid protocol: ${result.protocol}. Only http and https are allowed.`,
            },
            executionTime: Date.now() - startTime,
          };
        }

        return {
          success: true,
          data: result,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          data: {
            valid: false,
            error: (error as Error).message,
          },
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the WebSocket client tool.
 */
export function createWebSocketTool(): ToolHandler {
  return ToolBuilder.create('websocket', 'WebSocket Client')
    .description('Connect to a WebSocket and receive messages')
    .string('url', { required: true, description: 'WebSocket URL (ws:// or wss://)' })
    .object('headers', {}, { description: 'Connection headers' })
    .integer('timeout', { default: 30000, minimum: 5000, maximum: 120000, description: 'Connection timeout' })
    .integer('maxMessages', { default: 10, minimum: 1, maximum: 1000, description: 'Maximum messages to receive' })
    .string('send', { description: 'Message to send after connecting' })
    .category('network')
    .tags('websocket', 'ws', 'realtime', 'streaming')
    .timeout(60000)
    .executor(async (params, context) => {
      const startTime = Date.now();

      const url = params.url as string;
      const headers = (params.headers as Record<string, string>) ?? {};
      const timeout = (params.timeout as number) ?? 30000;
      const maxMessages = (params.maxMessages as number) ?? 10;
      const sendMessage = params.send as string | undefined;

      try {
        // Check boundaries
        const boundaryCheck = checkNetworkBoundary(url, context.boundaries);
        if (!boundaryCheck.allowed) {
          return {
            success: false,
            error: boundaryCheck.reason,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        // Dynamic import of ws
        const WebSocket = (await import('ws')).default;

        return new Promise((resolve) => {
          const messages: WebSocketMessage[] = [];
          let error: string | undefined;

          const ws = new WebSocket(url, {
            headers: {
              'User-Agent': 'WRAP-Nebula/1.0',
              ...headers,
            },
          });

          const timeoutId = setTimeout(() => {
            ws.close();
            resolve({
              success: true,
              data: {
                connected: true,
                messages,
                duration: Date.now() - startTime,
              } as WebSocketResult,
              executionTime: Date.now() - startTime,
            });
          }, timeout);

          ws.on('open', () => {
            // Send message if provided
            if (sendMessage) {
              ws.send(sendMessage);
            }
          });

          ws.on('message', (data: Buffer, isBinary: boolean) => {
            messages.push({
              type: isBinary ? 'binary' : 'text',
              data: isBinary ? data : data.toString(),
              timestamp: Date.now(),
            });

            // Close after max messages
            if (messages.length >= maxMessages) {
              clearTimeout(timeoutId);
              ws.close();
            }
          });

          ws.on('error', (err: Error) => {
            error = err.message;
          });

          ws.on('close', () => {
            clearTimeout(timeoutId);
            resolve({
              success: !error,
              data: {
                connected: messages.length > 0,
                messages,
                error,
                duration: Date.now() - startTime,
              } as WebSocketResult,
              executionTime: Date.now() - startTime,
            });
          });
        });
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'WEBSOCKET_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

/**
 * Create the download file tool.
 */
export function createDownloadTool(): ToolHandler {
  return ToolBuilder.create('download', 'Download File')
    .description('Download a file from a URL')
    .string('url', { required: true, description: 'URL to download from' })
    .string('destination', { required: true, description: 'Local path to save file' })
    .integer('timeout', { default: 60000, minimum: 5000, maximum: 300000, description: 'Download timeout' })
    .integer('maxSize', { default: 10485760, minimum: 1024, maximum: 104857600, description: 'Maximum file size in bytes' })
    .category('network')
    .tags('download', 'file', 'http')
    .timeout(120000)
    .executor(async (params, context) => {
      const startTime = Date.now();
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const url = params.url as string;
      const destination = params.destination as string;
      const timeout = (params.timeout as number) ?? 60000;
      const maxSize = (params.maxSize as number) ?? 10 * 1024 * 1024; // 10MB default

      try {
        // Check network boundaries
        const networkCheck = checkNetworkBoundary(url, context.boundaries);
        if (!networkCheck.allowed) {
          return {
            success: false,
            error: `Network: ${networkCheck.reason}`,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        // Check file boundaries
        const { checkPathBoundary } = await import('./index');
        const fileCheck = checkPathBoundary(destination, 'write', context.boundaries);
        if (!fileCheck.allowed) {
          return {
            success: false,
            error: `File: ${fileCheck.reason}`,
            errorCode: 'BOUNDARY_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          clearTimeout(timeoutId);
          return {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            errorCode: 'HTTP_ERROR',
            executionTime: Date.now() - startTime,
          };
        }

        // Check content length
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > maxSize) {
          clearTimeout(timeoutId);
          return {
            success: false,
            error: `File too large: ${contentLength} bytes (max: ${maxSize})`,
            errorCode: 'FILE_TOO_LARGE',
            executionTime: Date.now() - startTime,
          };
        }

        // Create destination directory
        const resolvedPath = path.resolve(context.workingDirectory, destination);
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

        // Download to file
        const buffer = await response.arrayBuffer();
        clearTimeout(timeoutId);

        if (buffer.byteLength > maxSize) {
          return {
            success: false,
            error: `File too large: ${buffer.byteLength} bytes (max: ${maxSize})`,
            errorCode: 'FILE_TOO_LARGE',
            executionTime: Date.now() - startTime,
          };
        }

        await fs.writeFile(resolvedPath, Buffer.from(buffer));

        return {
          success: true,
          data: {
            url,
            destination,
            size: buffer.byteLength,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          errorCode: 'DOWNLOAD_ERROR',
          executionTime: Date.now() - startTime,
        };
      }
    })
    .build();
}

// ============================================================================
// Register All Web Tools
// ============================================================================

/**
 * Register all web tools to a registry.
 */
export function registerWebTools(registry: {
  register: (entry: ToolHandler) => void;
}): void {
  registry.register(createHttpRequestTool());
  registry.register(createJsonRequestTool());
  registry.register(createUrlValidationTool());
  registry.register(createWebSocketTool());
  registry.register(createDownloadTool());
}

// ============================================================================
// Exports
// ============================================================================

export {
  RateLimiter,
  globalRateLimiter,
  createHttpRequestTool,
  createJsonRequestTool,
  createUrlValidationTool,
  createWebSocketTool,
  createDownloadTool,
  registerWebTools,
};

export type {
  HttpRequestOptions,
  HttpResponse,
  WebSocketOptions,
  WebSocketMessage,
  WebSocketResult,
  RateLimitConfig,
  RateLimitEntry,
  UrlValidationResult,
};

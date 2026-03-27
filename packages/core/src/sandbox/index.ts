/**
 * WRAP NEBULA v2.0 - Sandbox Bridge
 * Communication bridge to Rust Safety Governor
 */

import * as net from 'net';
import * as child_process from 'child_process';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
  SandboxInterface,
  SandboxExecuteOptions,
  SandboxResult,
  SandboxBoundaries,
  SecurityError,
  WrapError,
} from '../types';

// ============================================================================
// Types
// ============================================================================

interface GovernorRequest {
  id: string;
  type: 'execute' | 'check_permission' | 'get_permissions' | 'health';
  payload: Record<string, unknown>;
}

interface GovernorResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

interface SandboxConfig {
  governorAddress: string;
  timeout: number;
  autoStart: boolean;
  governorPath?: string;
}

// ============================================================================
// Sandbox Bridge Implementation
// ============================================================================

export class SandboxBridge extends EventEmitter implements SandboxInterface {
  private config: SandboxConfig;
  private socket: net.Socket | null = null;
  private connected: boolean = false;
  private requestQueue: Map<string, {
    resolve: (value: GovernorResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private requestId: number = 0;
  private buffer: string = '';
  private governorProcess: child_process.ChildProcess | null = null;

  constructor(governorAddress: string, config: Partial<SandboxConfig> = {}) {
    super();
    this.config = {
      governorAddress,
      timeout: 30000,
      autoStart: true,
      ...config,
    };
  }

  /**
   * Connect to Governor
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    const [host, port] = this.config.governorAddress.split(':');

    // Try to start governor if auto-start enabled
    if (this.config.autoStart) {
      await this.startGovernor();
    }

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      this.socket.on('connect', () => {
        this.connected = true;
        this.emit('connected');
        resolve();
      });

      this.socket.on('data', (data: Buffer) => {
        this.handleData(data);
      });

      this.socket.on('error', (error) => {
        this.connected = false;
        this.emit('error', error);
        if (!this.connected) {
          reject(new WrapError(`Failed to connect to Governor: ${error.message}`, 'GOVERNOR_CONNECTION_ERROR'));
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      this.socket.connect(parseInt(port), host);
    });
  }

  /**
   * Disconnect from Governor
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Clear pending requests
    for (const [id, pending] of this.requestQueue) {
      clearTimeout(pending.timeout);
      pending.reject(new WrapError('Connection closed', 'CONNECTION_CLOSED'));
    }
    this.requestQueue.clear();

    // Close socket
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    // Stop governor process
    if (this.governorProcess) {
      this.governorProcess.kill();
      this.governorProcess = null;
    }

    this.connected = false;
  }

  /**
   * Start Governor process
   */
  private async startGovernor(): Promise<void> {
    const governorPath = this.config.governorPath || 
      path.join(__dirname, '..', '..', '..', '..', 'crates', 'governor', 'target', 'release', 'governor');

    try {
      this.governorProcess = child_process.spawn(governorPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.governorProcess.on('error', (error) => {
        console.error('Governor process error:', error);
      });

      this.governorProcess.stdout?.on('data', (data) => {
        console.log(`[Governor] ${data.toString()}`);
      });

      this.governorProcess.stderr?.on('data', (data) => {
        console.error(`[Governor Error] ${data.toString()}`);
      });

      // Wait for governor to start
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.warn('Failed to start Governor process:', error);
    }
  }

  /**
   * Handle incoming data
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete messages
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: GovernorResponse = JSON.parse(line);
        const pending = this.requestQueue.get(response.id);

        if (pending) {
          clearTimeout(pending.timeout);
          this.requestQueue.delete(response.id);

          if (response.success) {
            pending.resolve(response);
          } else {
            pending.reject(new SecurityError(response.error || 'Governor error'));
          }
        }
      } catch (error) {
        console.error('Failed to parse Governor response:', error);
      }
    }
  }

  /**
   * Send request to Governor
   */
  private async sendRequest(request: GovernorRequest): Promise<GovernorResponse> {
    if (!this.connected || !this.socket) {
      throw new WrapError('Not connected to Governor', 'NOT_CONNECTED');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestQueue.delete(request.id);
        reject(new WrapError('Governor request timeout', 'TIMEOUT'));
      }, this.config.timeout);

      this.requestQueue.set(request.id, { resolve, reject, timeout });

      this.socket!.write(JSON.stringify(request) + '\n');
    });
  }

  // ==========================================================================
  // SandboxInterface Implementation
  // ==========================================================================

  /**
   * Execute command in sandbox
   */
  async execute(command: string, options: SandboxExecuteOptions = {}): Promise<SandboxResult> {
    const request: GovernorRequest = {
      id: `exec-${++this.requestId}`,
      type: 'execute',
      payload: {
        command,
        timeout: options.timeout || this.config.timeout,
        cwd: options.cwd,
        env: options.env,
        stdin: options.stdin,
        captureOutput: options.captureOutput !== false,
      },
    };

    const response = await this.sendRequest(request);

    return response.result as SandboxResult;
  }

  /**
   * Check if command is allowed
   */
  isAllowed(command: string): boolean {
    // Synchronous check - requires local implementation
    const blockedCommands = [
      'rm -rf /',
      'mkfs',
      'dd if=/dev/zero',
      ':(){ :|:& };:',
      'chmod -R 777 /',
      'chown -R',
      'wget http',
      'curl http',
      'nc -l',
      'ncat',
    ];

    const lowerCommand = command.toLowerCase();
    return !blockedCommands.some(blocked => lowerCommand.includes(blocked));
  }

  /**
   * Get allowed permissions
   */
  getPermissions(): string[] {
    return [
      'fs.read',
      'fs.write',
      'fs.delete',
      'fs.list',
      'shell.execute',
      'network.http',
      'network.websocket',
    ];
  }

  // ==========================================================================
  // Additional Methods
  // ==========================================================================

  /**
   * Check Governor health
   */
  async health(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const request: GovernorRequest = {
        id: `health-${++this.requestId}`,
        type: 'health',
        payload: {},
      };

      const response = await this.sendRequest(request);
      return response.success;
    } catch {
      return false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get Governor address
   */
  getAddress(): string {
    return this.config.governorAddress;
  }
}

// ============================================================================
// In-Memory Sandbox (Fallback)
// ============================================================================

export class InMemorySandbox implements SandboxInterface {
  private allowedCommands: Set<string> = new Set();
  private deniedCommands: Set<string> = new Set();

  constructor() {
    // Default allowed commands
    this.allowedCommands.add('echo');
    this.allowedCommands.add('pwd');
    this.allowedCommands.add('ls');
    this.allowedCommands.add('cat');
    this.allowedCommands.add('grep');
    this.allowedCommands.add('find');
    this.allowedCommands.add('mkdir');
    this.allowedCommands.add('touch');
    this.allowedCommands.add('cp');
    this.allowedCommands.add('mv');

    // Blocked commands
    this.deniedCommands.add('rm');
    this.deniedCommands.add('sudo');
    this.deniedCommands.add('su');
    this.deniedCommands.add('chmod');
    this.deniedCommands.add('chown');
    this.deniedCommands.add('mkfs');
    this.deniedCommands.add('dd');
    this.deniedCommands.add('wget');
    this.deniedCommands.add('curl');
  }

  async execute(command: string, options: SandboxExecuteOptions = {}): Promise<SandboxResult> {
    if (!this.isAllowed(command)) {
      return {
        success: false,
        exitCode: 126,
        stdout: '',
        stderr: 'Command not allowed',
        duration: 0,
      };
    }

    // Simulate execution
    const startTime = Date.now();

    try {
      const parts = command.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);

      let stdout = '';
      let stderr = '';

      switch (cmd) {
        case 'echo':
          stdout = args.join(' ');
          break;
        case 'pwd':
          stdout = options.cwd || process.cwd();
          break;
        case 'ls':
          stdout = 'file1.txt\nfile2.txt\ndirectory/';
          break;
        case 'cat':
          stdout = 'File content would appear here';
          break;
        default:
          stdout = `Executed: ${command}`;
      }

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  isAllowed(command: string): boolean {
    const cmd = command.split(' ')[0];
    
    if (this.deniedCommands.has(cmd)) {
      return false;
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /\brm\s+-rf\b/,
      /\bsudo\b/,
      /\b>\s*\/dev\/sd/,
      /\bmkfs\b/,
      /\bdd\s+if=/,
      /:$$\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;:/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return false;
      }
    }

    return true;
  }

  getPermissions(): string[] {
    return Array.from(this.allowedCommands).map(cmd => `command.${cmd}`);
  }
}

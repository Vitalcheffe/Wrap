/**
 * WRAP NEBULA VS Code — HTTP Client
 * Communicates with the WRAP Core API
 */

import * as http from 'http';

export interface AgentStatus {
  online: boolean;
  model: string;
  agent: string;
  memory: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  input_hash: string;
  output_hash: string;
  agent_id: string;
}

export class WrapClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, method: string = 'GET', body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${path}`);
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', (e) => reject(new Error(`Connection failed: ${e.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  async checkStatus(): Promise<AgentStatus | null> {
    try {
      return await this.request<AgentStatus>('/api/status');
    } catch {
      return null;
    }
  }

  async getMessages(): Promise<ChatMessage[]> {
    try {
      return await this.request<ChatMessage[]>('/api/messages');
    } catch {
      return [];
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<string> {
    try {
      const result = await this.request<{ reply: string }>('/api/chat', 'POST', {
        sessionId,
        message: content,
      });
      return result.reply || 'No response from agent';
    } catch (e: unknown) {
      const err = e as Error;
      throw new Error(`Failed to send message: ${err.message}`);
    }
  }

  async getAuditTrail(): Promise<AuditEntry[]> {
    try {
      return await this.request<AuditEntry[]>('/api/audit');
    } catch {
      return [];
    }
  }

  async getAuditStats(): Promise<{ total: number; valid: number; invalid: number }> {
    try {
      return await this.request<{ total: number; valid: number; invalid: number }>('/api/audit/stats');
    } catch {
      return { total: 0, valid: 0, invalid: 0 };
    }
  }
}

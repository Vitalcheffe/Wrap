/**
 * WRAP NEBULA — Multi-Agent System
 * Signed inter-agent communication and task collaboration
 * 
 * Architecture:
 * - Each agent has its own SOUL.md, memory, and identity
 * - Agents communicate via a signed message bus
 * - Tasks can be delegated from one agent to another
 * - All inter-agent messages are Ed25519-signed
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface AgentIdentity {
  id: string;
  name: string;
  publicKey: string;
  address: string; // host:port
  skills: string[];
  status: 'online' | 'busy' | 'offline';
  lastSeen: number;
}

export interface SignedMessage {
  id: string;
  from: string; // agent id
  to: string;   // agent id or 'broadcast'
  type: 'task' | 'result' | 'query' | 'response' | 'heartbeat';
  payload: unknown;
  timestamp: number;
  signature: string; // Ed25519 signature of the message content
}

export interface Task {
  id: string;
  description: string;
  requiredSkills: string[];
  assignedTo?: string;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
  result?: unknown;
  createdAt: number;
  completedAt?: number;
}

// ============================================================================
// Agent Message Bus
// ============================================================================

export class AgentMessageBus extends EventEmitter {
  private agents: Map<string, AgentIdentity> = new Map();
  private signingKey: crypto.KeyObject;
  private myId: string;
  private myAddress: string;
  private server: http.Server | null = null;
  private messageLog: SignedMessage[] = [];

  constructor(myId: string, myAddress: string, privateKey?: crypto.KeyObject) {
    super();
    this.myId = myId;
    this.myAddress = myAddress;

    if (privateKey) {
      this.signingKey = privateKey;
    } else {
      const { privateKey: key } = crypto.generateKeyPairSync('ed25519');
      this.signingKey = key;
    }
  }

  /**
   * Get this agent's public key
   */
  getPublicKey(): string {
    const pubKey = crypto.createPublicKey(this.signingKey);
    return pubKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  /**
   * Sign a message
   */
  private sign(content: string): string {
    return crypto.sign(null, Buffer.from(content), this.signingKey).toString('hex');
  }

  /**
   * Verify a message signature
   */
  verify(message: SignedMessage, publicKeyPem: string): boolean {
    try {
      const content = JSON.stringify({
        id: message.id,
        from: message.from,
        to: message.to,
        type: message.type,
        payload: message.payload,
        timestamp: message.timestamp,
      });
      const publicKey = crypto.createPublicKey(publicKeyPem);
      return crypto.verify(null, Buffer.from(content), publicKey, Buffer.from(message.signature, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Create and sign a message
   */
  createMessage(to: string, type: SignedMessage['type'], payload: unknown): SignedMessage {
    const message: Omit<SignedMessage, 'signature'> = {
      id: crypto.randomUUID().slice(0, 8),
      from: this.myId,
      to,
      type,
      payload,
      timestamp: Date.now(),
    };

    const content = JSON.stringify(message);
    const signature = this.sign(content);

    return { ...message, signature };
  }

  /**
   * Send a message to another agent
   */
  async send(targetId: string, type: SignedMessage['type'], payload: unknown): Promise<unknown> {
    const target = this.agents.get(targetId);
    if (!target) throw new Error(`Agent "${targetId}" not found`);
    if (target.status === 'offline') throw new Error(`Agent "${targetId}" is offline`);

    const message = this.createMessage(targetId, type, payload);
    this.messageLog.push(message);

    return new Promise((resolve, reject) => {
      const url = new URL(`http://${target.address}/agent/message`);
      const body = JSON.stringify(message);

      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(type: SignedMessage['type'], payload: unknown): Promise<void> {
    const message = this.createMessage('broadcast', type, payload);
    this.messageLog.push(message);

    for (const [id, agent] of this.agents) {
      if (id === this.myId || agent.status === 'offline') continue;
      try {
        await this.send(id, type, payload);
      } catch {
        // Agent unreachable, mark as offline
        agent.status = 'offline';
      }
    }
  }

  /**
   * Start listening for incoming messages
   */
  startListening(port: number): void {
    this.server = http.createServer((req, res) => {
      if (req.url === '/agent/message' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const message: SignedMessage = JSON.parse(body);

            // Verify signature if we know the sender
            const sender = this.agents.get(message.from);
            if (sender && !this.verify(message, sender.publicKey)) {
              res.writeHead(403);
              res.end(JSON.stringify({ error: 'Invalid signature' }));
              return;
            }

            this.messageLog.push(message);
            this.emit('message', message);

            // Auto-respond to heartbeats
            if (message.type === 'heartbeat') {
              res.end(JSON.stringify({ status: 'ok', agentId: this.myId }));
            } else {
              res.end(JSON.stringify({ received: true }));
            }
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid message' }));
          }
        });
      } else if (req.url === '/agent/status') {
        res.end(JSON.stringify({
          id: this.myId,
          address: this.myAddress,
          publicKey: this.getPublicKey(),
          agents: Array.from(this.agents.values()),
        }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.listen(port, () => {
      console.log(`  ✓ Agent bus listening on port ${port}`);
    });
  }

  /**
   * Register another agent
   */
  registerAgent(agent: AgentIdentity): void {
    this.agents.set(agent.id, { ...agent, lastSeen: Date.now() });
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * Get all known agents
   */
  getAgents(): AgentIdentity[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get message log
   */
  getMessageLog(n: number = 50): SignedMessage[] {
    return this.messageLog.slice(-n);
  }

  /**
   * Stop the message bus
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

// ============================================================================
// Task Delegator
// ============================================================================

export class TaskDelegator {
  private bus: AgentMessageBus;
  private tasks: Map<string, Task> = new Map();

  constructor(bus: AgentMessageBus) {
    this.bus = bus;

    // Listen for task results
    bus.on('message', (message: SignedMessage) => {
      if (message.type === 'result') {
        const result = message.payload as { taskId: string; result: unknown; success: boolean };
        const task = this.tasks.get(result.taskId);
        if (task) {
          task.status = result.success ? 'completed' : 'failed';
          task.result = result.result;
          task.completedAt = Date.now();
        }
      }
    });
  }

  /**
   * Create a new task
   */
  createTask(description: string, requiredSkills: string[]): Task {
    const task: Task = {
      id: crypto.randomUUID().slice(0, 8),
      description,
      requiredSkills,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Delegate a task to the best available agent
   */
  async delegate(taskId: string): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);

    // Find agents with required skills
    const agents = this.bus.getAgents().filter(agent =>
      agent.status === 'online' &&
      task.requiredSkills.every(skill => agent.skills.includes(skill))
    );

    if (agents.length === 0) {
      task.status = 'failed';
      task.result = 'No agent available with required skills';
      return task;
    }

    // Pick the least busy agent (simple round-robin for now)
    const agent = agents[0];

    task.assignedTo = agent.id;
    task.status = 'assigned';

    try {
      await this.bus.send(agent.id, 'task', {
        taskId: task.id,
        description: task.description,
        requiredSkills: task.requiredSkills,
      });
      task.status = 'running';
    } catch {
      task.status = 'failed';
      task.result = `Failed to send task to agent ${agent.id}`;
    }

    return task;
  }

  /**
   * Get task status
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}

/**
 * WRAP Core - Main Entry Point
 * @module @wrap/core
 */

export * from './types';
export * from './sandbox';
export * from './agent';
export * from './tools';

import { v4 as uuidv4 } from 'uuid';
import { Sandbox, defaultBoundaries } from './sandbox';
import { Agent } from './agent';
import { ToolRegistry, builtInTools } from './tools';
import type {
  WRAP, AgentContext, Boundaries, ToolRegistry as IToolRegistry,
  OutputSchema, Message, Tool
} from './types';

// ============================================================================
// QUICK START FUNCTIONS
// ============================================================================

/**
 * Create a WRAP instance with minimal configuration
 */
export async function createWRAP<TOutput = unknown>(config: {
  prompt: string;
  tools?: Tool[];
  boundaries?: Partial<Boundaries>;
  output?: OutputSchema<TOutput>;
}): Promise<WRAP<TOutput>> {
  const id = uuidv4();

  const context: AgentContext = {
    conversationId: uuidv4(),
    messages: [{ id: uuidv4(), role: 'user', content: config.prompt, timestamp: new Date() }],
    systemPrompt: 'You are a helpful AI assistant.',
    metadata: {},
    environment: {},
    workingDirectory: process.cwd(),
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    priority: 'normal',
    maxContextTokens: 4096,
    cacheable: true
  };

  const boundaries: Boundaries = {
    ...defaultBoundaries,
    ...config.boundaries
  };

  const tools = new ToolRegistry(config.tools ?? builtInTools);

  return {
    id,
    context,
    tools,
    boundaries,
    output: config.output ?? { schema: { type: 'string' }, streaming: false, validation: 'none', coerce: false, onError: 'throw' },
    state: {
      status: 'pending',
      step: 'setup',
      progress: 0,
      tokens: { prompt: 0, completion: 0, total: 0, cached: 0, byModel: new Map() },
      costs: { input: 0, output: 0, total: 0, currency: 'USD', byModel: new Map() },
      toolCalls: [],
      errors: [],
      warnings: [],
      timeline: [],
      checkpoints: [],
      iterations: 0
    },
    telemetry: {
      traceId: id,
      spanId: uuidv4(),
      spans: [],
      metrics: [],
      logs: [],
      events: [],
      sampled: true
    }
  };
}

/**
 * Create a simple agent with default configuration
 */
export function createSimpleAgent(config: {
  model?: string;
  systemPrompt?: string;
  tools?: Tool[];
}): Agent {
  return new Agent({
    model: config.model ?? 'gpt-4',
    systemPrompt: config.systemPrompt ?? 'You are a helpful AI assistant.',
    tools: config.tools ?? builtInTools
  });
}

/**
 * Quick execution helper
 */
export async function quickExecute<TOutput = unknown>(
  prompt: string,
  options?: {
    tools?: Tool[];
    boundaries?: Partial<Boundaries>;
  }
): Promise<TOutput> {
  const agent = createSimpleAgent({ tools: options?.tools });
  const result = await agent.run(prompt);
  return result as TOutput;
}

/**
 * Create a sandbox
 */
export async function createSandbox(options?: {
  type?: 'process' | 'container' | 'v8' | 'wasm' | 'vm' | 'none';
  boundaries?: Partial<Boundaries>;
}): Promise<Sandbox> {
  return Sandbox.create({
    type: options?.type ?? 'process',
    boundaries: { ...defaultBoundaries, ...options?.boundaries }
  });
}

// ============================================================================
// VERSION INFO
// ============================================================================

export const VERSION = '1.0.0';
export const PROTOCOL = 'NEBULA';
export const BRAND = 'WRAP = Context + Tools + Boundaries + Output';

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  createWRAP,
  createSimpleAgent,
  quickExecute,
  createSandbox,
  Sandbox,
  Agent,
  ToolRegistry,
  VERSION,
  PROTOCOL,
  BRAND
};

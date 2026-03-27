/**
 * WRAP NEBULA v2.0 - Type Definitions
 * Complete type definitions for the JavaScript SDK
 */

// ============================================================================
// Enums
// ============================================================================

export enum MessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}

export enum ContentType {
  TEXT = 'text',
  IMAGE = 'image',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  THINKING = 'thinking',
}

export enum FinishReason {
  STOP = 'stop',
  TOOL_USE = 'tool_use',
  MAX_TOKENS = 'max_tokens',
  LENGTH = 'length',
  CONTENT_FILTER = 'content_filter',
  ERROR = 'error',
}

export enum Provider {
  ANTHROPIC = 'anthropic',
  OPENAI = 'openai',
  GOOGLE = 'google',
  OLLAMA = 'ollama',
  CUSTOM = 'custom',
}

export enum AgentStatus {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ERROR = 'error',
  STOPPED = 'stopped',
}

export enum EventType {
  CREATED = 'created',
  STARTED = 'started',
  PAUSED = 'paused',
  RESUMED = 'resumed',
  STOPPED = 'stopped',
  COMPLETED = 'completed',
  ERROR = 'error',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  THINKING = 'thinking',
  CONTENT = 'content',
  METRICS = 'metrics',
}

// ============================================================================
// Basic Types
// ============================================================================

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface ContentBlock {
  type: ContentType;
  text?: string;
  image?: { url: string } | { data: string; mediaType: string };
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  thinking?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  required?: string[];
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: string[];
  description?: string;
  [key: string]: unknown;
}

// ============================================================================
// Provider Types
// ============================================================================

export interface ProviderResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: string;
  latency: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  provider?: Provider;
  systemPrompt?: string;
  tools?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface AgentState {
  id: string;
  status: AgentStatus;
  createdAt: number;
  updatedAt: number;
  currentTask?: string;
  iterations: number;
  tokenUsage: TokenUsage;
  toolCalls: number;
  errors: string[];
}

export interface AgentEvent {
  type: string;
  timestamp: number;
  agentId: string;
  data: Record<string, unknown>;
}

export interface AgentMetrics {
  iterations: number;
  toolCalls: number;
  tokens: TokenUsage;
  latency: number;
  memoryUsage: number;
  errors: number;
}

// ============================================================================
// Conversation Types
// ============================================================================

export interface Conversation {
  id: string;
  messages: Message[];
  metadata: ConversationMetadata;
}

export interface ConversationMetadata {
  model: string;
  provider: string;
  created: number;
  lastUpdated: number;
  totalTokens: number;
  tags: string[];
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ModelConfig {
  provider: Provider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  baseUrl?: string;
  apiKey?: string;
}

export interface Boundaries {
  maxIterations: number;
  maxTokens: number;
  maxToolCalls: number;
  timeoutPerStep: number;
}

export interface Behavior {
  maxIterations: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  failOnToolError: boolean;
  parallelToolCalls: boolean;
  streamingEnabled: boolean;
  thinkingEnabled: boolean;
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface StreamEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface ContentDelta {
  type: 'text' | 'thinking' | 'tool_use';
  text?: string;
  toolCall?: Partial<ToolCall>;
}

// ============================================================================
// Server Types
// ============================================================================

export interface ServerConfig {
  port: number;
  host: string;
  governorAddress: string;
  vfsRoot: string;
  corsOrigins?: string[];
  maxRequestSize?: number;
  timeout?: number;
}

export interface ServerStats {
  uptime: number;
  activeAgents: number;
  requestsHandled: number;
  errors: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  version: string;
  uptime: number;
  agents: number;
}

// ============================================================================
// Event Handler Types
// ============================================================================

export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

/**
 * WRAP NEBULA v2.0 - Core Types
 * Complete TypeScript type definitions for the entire system
 */

// ============================================================================
// Core WRAP Primitive Types
// ============================================================================

/**
 * WRAP is the fundamental abstraction: Context + Tools + Boundaries + Output
 */
export interface WRAP {
  context: WRAPContext;
  tools: ToolRegistry;
  boundaries: Boundaries;
  output: OutputConfig;
}

export interface WRAPContext {
  conversation: Conversation;
  workingMemory: WorkingMemory;
  userState: UserState;
  metadata: Record<string, unknown>;
}

export interface WorkingMemory {
  shortTerm: MemoryEntry[];
  longTerm: MemoryEntry[];
  semantic: SemanticMemory[];
  episodic: EpisodicMemory[];
}

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  timestamp: number;
  importance: number;
  metadata: Record<string, unknown>;
}

export interface SemanticMemory {
  id: string;
  concept: string;
  relations: Array<{ relation: string; target: string }>;
  confidence: number;
}

export interface EpisodicMemory {
  id: string;
  event: string;
  timestamp: number;
  context: string;
  outcome?: string;
}

export interface UserState {
  preferences: Record<string, unknown>;
  history: string[];
  sessionData: Record<string, unknown>;
  permissions: string[];
}

export interface Boundaries {
  sandbox: SandboxBoundaries;
  vfs: VFSBoundaries;
  resources: ResourceBoundaries;
  network: NetworkBoundaries;
}

export interface SandboxBoundaries {
  enabled: boolean;
  timeout: number;
  maxMemory: number;
  maxCpu: number;
  allowedSystemCalls: string[];
  blockedSystemCalls: string[];
}

export interface VFSBoundaries {
  rootPath: string;
  readOnlyPaths: string[];
  writeOnlyPaths: string[];
  deniedPaths: string[];
  maxFileSize: number;
}

export interface ResourceBoundaries {
  maxIterations: number;
  maxTokens: number;
  maxToolCalls: number;
  timeoutPerStep: number;
}

export interface NetworkBoundaries {
  allowedHosts: string[];
  blockedHosts: string[];
  allowedProtocols: string[];
  maxRequestSize: number;
}

export interface OutputConfig {
  format: 'text' | 'json' | 'markdown' | 'structured';
  includeThinking: boolean;
  includeToolCalls: boolean;
  includeMetrics: boolean;
  telemetry: TelemetryConfig;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  model: ModelConfig;
  tools?: string[];
  systemPrompt?: string;
  boundaries?: Partial<Boundaries>;
  behavior?: AgentBehavior;
  persistence?: PersistenceConfig;
}

export interface ModelConfig {
  provider: Provider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  baseUrl?: string;
  apiKey?: string;
}

export type Provider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'custom';

export interface AgentBehavior {
  maxIterations: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  failOnToolError: boolean;
  parallelToolCalls: boolean;
  streamingEnabled: boolean;
  thinkingEnabled: boolean;
}

export interface PersistenceConfig {
  enabled: boolean;
  backend: 'memory' | 'file' | 'database';
  path?: string;
  ttl?: number;
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

export type AgentStatus = 'idle' | 'initializing' | 'running' | 'paused' | 'completed' | 'error' | 'stopped';

// ============================================================================
// Conversation Types
// ============================================================================

export interface Conversation {
  id: string;
  messages: Message[];
  metadata: ConversationMetadata;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ContentBlock {
  type: ContentType;
  text?: string;
  image?: ImageContent;
  toolCall?: ToolCallContent;
  toolResult?: ToolResultContent;
  thinking?: ThinkingContent;
}

export type ContentType = 'text' | 'image' | 'tool_call' | 'tool_result' | 'thinking';

export interface ImageContent {
  type: 'url' | 'base64';
  source: string;
  mediaType: string;
}

export interface ToolCallContent {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface ThinkingContent {
  text: string;
  signature?: string;
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
// Tool Types
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  required?: string[];
  category?: string;
  dangerous?: boolean;
  permissions?: string[];
  rateLimit?: RateLimitConfig;
  timeout?: number;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: string[];
  const?: unknown;
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
}

export interface RateLimitConfig {
  requestsPerSecond: number;
  requestsPerMinute: number;
  burstSize: number;
}

export interface ToolRegistry {
  tools: Map<string, RegisteredTool>;
  categories: Map<string, Set<string>>;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  middleware?: ToolMiddleware[];
  permissions: string[];
}

export type ToolHandler = (
  params: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

export type ToolMiddleware = (
  params: Record<string, unknown>,
  context: ToolContext,
  next: () => Promise<ToolResult>
) => Promise<ToolResult>;

export interface ToolContext {
  agentId: string;
  conversationId: string;
  vfs: VFSInterface;
  sandbox: SandboxInterface;
  secrets: SecretsInterface;
  telemetry: TelemetryInterface;
  permissions: string[];
  timeout: number;
  signal?: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
  duration?: number;
}

// ============================================================================
// Provider Types
// ============================================================================

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  models: ModelInfo[];
  rateLimits: RateLimitConfig;
  timeout: number;
  retryConfig: RetryConfig;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  pricing: ModelPricing;
}

export interface ModelPricing {
  inputTokens: number;
  outputTokens: number;
  currency: string;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  multiplier: number;
  retryableErrors: string[];
}

export interface ProviderRequest {
  model: string;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  toolChoice?: 'auto' | 'any' | 'none' | { type: 'tool'; name: string };
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
  system?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderMessage {
  role: MessageRole;
  content: string | ProviderContentBlock[];
  toolCalls?: ProviderToolCall[];
  toolCallId?: string;
}

export interface ProviderContentBlock {
  type: 'text' | 'image';
  text?: string;
  image?: { url: string } | { data: string; mediaType: string };
}

export interface ProviderTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  toolCalls: ToolCallContent[];
  usage: TokenUsage;
  finishReason: FinishReason;
  latency: number;
  metadata?: ProviderResponseMetadata;
}

export interface ProviderResponseMetadata {
  cached?: boolean;
  rerouted?: boolean;
  originalModel?: string;
  safetyFlags?: string[];
  thinking?: string;
}

export type FinishReason = 'stop' | 'tool_use' | 'max_tokens' | 'length' | 'content_filter' | 'error';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface StreamEvent {
  type: StreamEventType;
  timestamp: number;
  data: unknown;
}

export type StreamEventType = 
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'error'
  | 'ping';

export interface ContentDelta {
  type: 'text' | 'thinking' | 'tool_use';
  text?: string;
  toolCall?: Partial<ToolCallContent>;
}

// ============================================================================
// Sandbox Types
// ============================================================================

export interface SandboxInterface {
  execute(command: string, options?: SandboxExecuteOptions): Promise<SandboxResult>;
  isAllowed(command: string): boolean;
  getPermissions(): string[];
}

export interface SandboxExecuteOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  captureOutput?: boolean;
}

export interface SandboxResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  resourceUsage?: ResourceUsage;
}

export interface ResourceUsage {
  cpuTime: number;
  memoryPeak: number;
  bytesRead: number;
  bytesWritten: number;
}

// ============================================================================
// VFS Types
// ============================================================================

export interface VFSInterface {
  read(path: string): Promise<Buffer>;
  write(path: string, content: Buffer | string): Promise<void>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<VFSEntry[]>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<VFSStats>;
  mkdir(path: string): Promise<void>;
}

export interface VFSEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: number;
  permissions: string;
}

export interface VFSStats {
  size: number;
  created: number;
  modified: number;
  accessed: number;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

export interface VFSConfig {
  root: string;
  readOnlyPatterns: string[];
  writeOnlyPatterns: string[];
  deniedPatterns: string[];
  maxFileSize: number;
  maxTotalSize: number;
}

// ============================================================================
// Secrets Types
// ============================================================================

export interface SecretsInterface {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface SecretsConfig {
  providers: SecretsProvider[];
  cache: boolean;
  cacheTTL: number;
}

export type SecretsProvider = 
  | { type: 'env'; prefix?: string }
  | { type: 'file'; path: string }
  | { type: 'vault'; address: string; path: string; token?: string };

// ============================================================================
// Telemetry Types
// ============================================================================

export interface TelemetryInterface {
  startSpan(name: string, options?: SpanOptions): TelemetrySpan;
  recordMetric(name: string, value: number, attributes?: Record<string, unknown>): void;
  log(level: LogLevel, message: string, attributes?: Record<string, unknown>): void;
}

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  endpoint?: string;
  samplingRate: number;
  exportInterval: number;
  attributes: Record<string, unknown>;
}

export interface SpanOptions {
  kind: SpanKind;
  parent?: TelemetrySpan;
  attributes?: Record<string, unknown>;
  links?: SpanLink[];
}

export type SpanKind = 'internal' | 'client' | 'server' | 'producer' | 'consumer';

export interface TelemetrySpan {
  spanId: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: SpanStatus;
  end(): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  setAttribute(key: string, value: unknown): void;
  setStatus(status: SpanStatus): void;
  recordException(error: Error): void;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: Record<string, unknown>;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export type SpanStatus = { code: 'ok' | 'error' | 'unset'; message?: string };

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ============================================================================
// State Types
// ============================================================================

export interface StateConfig {
  backend: 'memory' | 'file' | 'redis' | 'database';
  path?: string;
  ttl?: number;
  maxSize?: number;
}

export interface StateEntry {
  key: string;
  value: unknown;
  createdAt: number;
  updatedAt: number;
  ttl?: number;
  tags?: string[];
}

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPServerConfig {
  name: string;
  version: string;
  capabilities: MCPCapabilities;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
}

export interface MCPCapabilities {
  tools: { listChanged: boolean };
  resources: { subscribe: boolean; listChanged: boolean };
  prompts: { listChanged: boolean };
  logging: {};
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments: MCPServerConfig[];
}

export interface MCPArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// Policy Types
// ============================================================================

export interface PolicyConfig {
  rules: PolicyRule[];
  defaultAction: 'allow' | 'deny';
  auditMode: boolean;
}

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  condition: PolicyCondition;
  action: 'allow' | 'deny' | 'transform';
  transform?: PolicyTransform;
  priority: number;
  enabled: boolean;
}

export interface PolicyCondition {
  type: 'tool_call' | 'content' | 'resource' | 'rate_limit';
  pattern?: string;
  patterns?: string[];
  operator?: 'equals' | 'contains' | 'matches' | 'starts_with' | 'ends_with';
  field?: string;
  value?: unknown;
}

export interface PolicyTransform {
  type: 'redact' | 'mask' | 'replace';
  pattern: string;
  replacement: string;
}

// ============================================================================
// Audit Types
// ============================================================================

export interface AuditEntry {
  id: string;
  timestamp: number;
  type: AuditEventType;
  agentId: string;
  userId?: string;
  sessionId?: string;
  action: string;
  resource?: string;
  details: Record<string, unknown>;
  outcome: 'success' | 'failure' | 'blocked';
  previousHash: string;
  hash: string;
  signature: string;
}

export type AuditEventType = 
  | 'agent_created'
  | 'agent_deleted'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'tool_called'
  | 'file_accessed'
  | 'file_modified'
  | 'network_request'
  | 'security_violation'
  | 'policy_violation'
  | 'rate_limit_exceeded';

// ============================================================================
// Error Types
// ============================================================================

export class WrapError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WrapError';
  }
}

export class ValidationError extends WrapError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class SecurityError extends WrapError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SECURITY_ERROR', details);
    this.name = 'SecurityError';
  }
}

export class SandboxError extends WrapError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SANDBOX_ERROR', details);
    this.name = 'SandboxError';
  }
}

export class ProviderError extends WrapError {
  constructor(message: string, public provider: string, details?: Record<string, unknown>) {
    super(message, 'PROVIDER_ERROR', { provider, ...details });
    this.name = 'ProviderError';
  }
}

export class RateLimitError extends WrapError {
  constructor(message: string, public retryAfter: number, details?: Record<string, unknown>) {
    super(message, 'RATE_LIMIT_ERROR', { retryAfter, ...details });
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends WrapError {
  constructor(message: string, public timeout: number, details?: Record<string, unknown>) {
    super(message, 'TIMEOUT_ERROR', { timeout, ...details });
    this.name = 'TimeoutError';
  }
}

export class PolicyError extends WrapError {
  constructor(message: string, public rule: string, details?: Record<string, unknown>) {
    super(message, 'POLICY_ERROR', { rule, ...details });
    this.name = 'PolicyError';
  }
}

// ============================================================================
// Event Types
// ============================================================================

export interface AgentEvent {
  type: AgentEventType;
  timestamp: number;
  agentId: string;
  data: unknown;
}

export type AgentEventType = 
  | 'created'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'stopped'
  | 'completed'
  | 'error'
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'content'
  | 'metrics';

export interface ToolCallEvent {
  type: 'tool_call';
  toolCall: ToolCallContent;
  iteration: number;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  result: ToolResult;
  duration: number;
}

export interface ThinkingEvent {
  type: 'thinking';
  content: string;
}

export interface ContentEvent {
  type: 'content';
  delta: string;
  full: string;
}

export interface MetricsEvent {
  type: 'metrics';
  metrics: AgentMetrics;
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
// Server Types
// ============================================================================

export interface ServerConfig {
  port: number;
  host: string;
  governorAddress: string;
  vfsRoot: string;
  secretsConfig?: SecretsConfig;
  telemetryConfig?: TelemetryConfig;
  stateConfig?: StateConfig;
  corsOrigins?: string[];
  maxRequestSize: number;
  timeout: number;
}

export interface ServerStats {
  uptime: number;
  activeAgents: number;
  requestsHandled: number;
  errors: number;
  memoryUsage: NodeJS.MemoryUsage;
}

export interface HealthCheckResult {
  healthy: boolean;
  version: string;
  uptime: number;
  agents: number;
  components: ComponentHealth[];
}

export interface ComponentHealth {
  name: string;
  healthy: boolean;
  latency?: number;
  error?: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type MaybePromise<T> = T | Promise<T>;

export type EventCallback<T = unknown> = (event: T) => MaybePromise<void>;

export interface Disposable {
  dispose(): MaybePromise<void>;
}

export interface AsyncDisposable {
  [Symbol.asyncDispose](): Promise<void>;
}

export interface EventEmitterLike<T extends Record<string, unknown>> {
  on<K extends keyof T>(event: K, callback: EventCallback<T[K]>): this;
  off<K extends keyof T>(event: K, callback: EventCallback<T[K]>): this;
  emit<K extends keyof T>(event: K, data: T[K]): boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_BOUNDARIES: Boundaries = {
  sandbox: {
    enabled: true,
    timeout: 30000,
    maxMemory: 512 * 1024 * 1024,
    maxCpu: 80,
    allowedSystemCalls: [],
    blockedSystemCalls: [],
  },
  vfs: {
    rootPath: '/sandbox',
    readOnlyPaths: [],
    writeOnlyPaths: [],
    deniedPaths: [],
    maxFileSize: 10 * 1024 * 1024,
  },
  resources: {
    maxIterations: 100,
    maxTokens: 128000,
    maxToolCalls: 500,
    timeoutPerStep: 60000,
  },
  network: {
    allowedHosts: [],
    blockedHosts: [],
    allowedProtocols: ['https'],
    maxRequestSize: 10 * 1024 * 1024,
  },
};

export const DEFAULT_BEHAVIOR: AgentBehavior = {
  maxIterations: 100,
  timeout: 300000,
  retryAttempts: 3,
  retryDelay: 1000,
  failOnToolError: false,
  parallelToolCalls: false,
  streamingEnabled: true,
  thinkingEnabled: true,
};

export const VERSION = '2.0.0';

/**
 * WRAP Core Types - Foundation for Universal AI Agent Runtime
 * @module @wrap/core/types
 *
 * This module defines all core types for the WRAP system.
 * The fundamental primitive is: WRAP = Context + Tools + Boundaries + Output
 */

import { z } from 'zod';

// ============================================================================
// CORE PRIMITIVE: WRAP = Context + Tools + Boundaries + Output
// ============================================================================

/**
 * The fundamental WRAP primitive that encapsulates all agent execution state.
 * This is the core unit of execution in the WRAP system.
 *
 * @template TOutput - The expected output type
 */
export interface WRAP<TOutput = unknown> {
  /** Unique identifier for this execution context */
  id: string;
  /** Execution context with conversation history and state */
  context: AgentContext;
  /** Available tools the agent can invoke */
  tools: ToolRegistry;
  /** Security boundaries and resource limits */
  boundaries: Boundaries;
  /** Output schema for structured responses */
  output: OutputSchema<TOutput>;
  /** Current execution state */
  state: ExecutionState;
  /** Telemetry and tracing data */
  telemetry: TelemetryData;
}

// ============================================================================
// AGENT CONTEXT
// ============================================================================

/**
 * Agent execution context containing all state for a conversation.
 * This includes message history, system prompts, and configuration.
 */
export interface AgentContext {
  /** Unique conversation/session ID */
  conversationId: string;
  /** All messages in the conversation */
  messages: Message[];
  /** System prompt defining agent behavior */
  systemPrompt: string;
  /** User metadata and preferences */
  metadata: Record<string, unknown>;
  /** Environment variables accessible to the agent */
  environment: Record<string, string>;
  /** Working directory for file operations */
  workingDirectory: string;
  /** Timestamp when context was created */
  createdAt: Date;
  /** Timestamp of last update */
  updatedAt: Date;
  /** Conversation tags for categorization */
  tags: string[];
  /** Priority level for execution queue */
  priority: 'low' | 'normal' | 'high' | 'critical';
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Whether to cache context for resumption */
  cacheable: boolean;
  /** Parent context ID for nested conversations */
  parentId?: string;
}

/**
 * Message types in a conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

/**
 * A single message in the conversation.
 * Supports multimodal content and tool calls.
 */
export interface Message {
  /** Unique message identifier */
  id: string;
  /** Role of the message sender */
  role: MessageRole;
  /** Message content (text or multimodal) */
  content: MessageContent;
  /** Name of the sender (for tool/function messages) */
  name?: string;
  /** Tool calls requested in this message */
  toolCalls?: ToolCall[];
  /** Tool call ID this message responds to */
  toolCallId?: string;
  /** Message timestamp */
  timestamp: Date;
  /** Additional metadata */
  metadata?: MessageMetadata;
  /** Token count for this message */
  tokenCount?: number;
  /** Message status */
  status?: MessageStatus;
  /** Finish reason for assistant messages */
  finishReason?: FinishReason;
}

/**
 * Message content can be text or multimodal parts
 */
export type MessageContent = string | ContentPart[];

/**
 * Content part for multimodal messages
 */
export interface ContentPart {
  /** Type of content */
  type: 'text' | 'image' | 'image_url' | 'audio' | 'video' | 'file';
  /** Text content for text parts */
  text?: string;
  /** Media MIME type */
  mediaType?: string;
  /** Base64 encoded data */
  data?: string | Buffer;
  /** URL for remote content */
  url?: string;
  /** Image URL details */
  imageUrl?: { url: string; detail?: 'auto' | 'low' | 'high' };
  /** File details */
  file?: { filename: string; size: number; mimeType: string };
}

/**
 * Message metadata
 */
export interface MessageMetadata {
  /** Source of the message */
  source?: string;
  /** Model used for generation */
  model?: string;
  /** Provider used */
  provider?: string;
  /** Temperature used */
  temperature?: number;
  /** Custom properties */
  custom?: Record<string, unknown>;
}

/**
 * Message processing status
 */
export type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'cancelled';

/**
 * Reason for message completion
 */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'function_call'
  | 'error';

// ============================================================================
// TOOLS
// ============================================================================

/**
 * Tool definition that agents can invoke.
 * Tools are the primary way agents interact with external systems.
 */
export interface Tool {
  /** Unique tool identifier (alphanumeric, underscores, hyphens) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** Input schema using Zod or JSON Schema */
  inputSchema: z.ZodType<any> | JSONSchema;
  /** Output schema for structured responses */
  outputSchema?: z.ZodType<any> | JSONSchema;
  /** Tool execution handler */
  handler: ToolHandler;
  /** Whether this tool can modify state (vs read-only) */
  destructive: boolean;
  /** Required permissions to use this tool */
  permissions: Permission[];
  /** Timeout in milliseconds */
  timeout: number;
  /** Retry configuration */
  retry: RetryConfig;
  /** Whether tool execution is streamed */
  streaming: boolean;
  /** Tool metadata */
  metadata: ToolMetadata;
  /** Whether tool is enabled */
  enabled: boolean;
  /** Rate limit for this specific tool */
  rateLimit?: RateLimitConfig;
  /** Cost of using this tool (if applicable) */
  cost?: ToolCost;
}

/**
 * Tool execution handler function
 */
export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolContext
) => Promise<TOutput> | TOutput;

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  /** The sandbox this tool is executing in */
  sandbox: SandboxInfo;
  /** Current message context */
  message: Message;
  /** Callback to emit streaming events */
  emit: (event: StreamEvent) => void;
  /** Abort signal for cancellation */
  signal: AbortSignal;
  /** Logger instance */
  logger: Logger;
  /** Access to virtual filesystem */
  fs: VirtualFileSystem;
  /** Access to network (if permitted) */
  network: NetworkAccess;
  /** Tool call ID for correlation */
  toolCallId: string;
  /** Execution timeout remaining */
  timeoutRemaining: number;
  /** Parent trace context */
  traceContext?: TraceContext;
}

/**
 * Tool call from an agent
 */
export interface ToolCall {
  /** Unique call identifier */
  id: string;
  /** Tool name */
  name: string;
  /** Input arguments */
  input: Record<string, unknown>;
  /** Execution status */
  status: ToolCallStatus;
  /** Output result */
  output?: unknown;
  /** Error if failed */
  error?: ToolError;
  /** When execution started */
  startedAt?: Date;
  /** When execution completed */
  completedAt?: Date;
  /** Duration in milliseconds */
  duration?: number;
  /** Number of retry attempts */
  attempts?: number;
}

/**
 * Tool call execution status
 */
export type ToolCallStatus =
  | 'pending'
  | 'validating'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * Tool registry managing all available tools
 */
export interface ToolRegistry {
  /** Map of tool name to tool definition */
  tools: Map<string, Tool>;
  /** Categories for organization */
  categories: Map<string, Set<string>>;
  /** Register a new tool */
  register(tool: Tool): void;
  /** Unregister a tool */
  unregister(name: string): void;
  /** Get a tool by name */
  get(name: string): Tool | undefined;
  /** Check if tool exists */
  has(name: string): boolean;
  /** List all tools */
  list(): Tool[];
  /** Get tools by category */
  byCategory(category: string): Tool[];
  /** Validate tool input */
  validate(name: string, input: unknown): ValidationResult;
  /** Execute a tool */
  execute(name: string, input: unknown, context: ToolContext): Promise<unknown>;
  /** Get tool schemas for LLM */
  getSchemas(): ToolSchema[];
}

/**
 * Tool schema for LLM consumption
 */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

/**
 * Tool metadata for discovery and documentation
 */
export interface ToolMetadata {
  /** Tool version */
  version: string;
  /** Tool author */
  author?: string;
  /** Category for organization */
  category: string;
  /** Tags for search */
  tags: string[];
  /** Usage examples */
  examples: ToolExample[];
  /** Detailed documentation */
  documentation?: string;
  /** Deprecation notice */
  deprecated?: boolean;
  deprecationMessage?: string;
  /** Related tools */
  relatedTools?: string[];
  /** Minimum required permissions */
  requiredPermissions?: Permission[];
  /** Estimated execution time (ms) */
  estimatedDuration?: number;
}

/**
 * Tool usage example
 */
export interface ToolExample {
  /** Example description */
  description: string;
  /** Example input */
  input: Record<string, unknown>;
  /** Expected output */
  output?: unknown;
  /** Notes about the example */
  notes?: string;
}

/**
 * Tool cost configuration
 */
export interface ToolCost {
  /** Cost per call */
  perCall?: number;
  /** Cost per unit (e.g., per MB, per request) */
  perUnit?: { unit: string; cost: number };
  /** Currency */
  currency: string;
}

// ============================================================================
// BOUNDARIES - Security and Resource Limits
// ============================================================================

/**
 * Security boundaries that constrain agent behavior.
 * These define the sandbox within which agents operate.
 */
export interface Boundaries {
  /** Time limit for execution in milliseconds */
  timeout: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** CPU limit (0-1 for percentage) */
  cpuLimit: number;
  /** Maximum number of tool calls */
  maxToolCalls: number;
  /** Maximum recursion depth */
  maxRecursionDepth: number;
  /** Network access permissions */
  network: NetworkBoundaries;
  /** Filesystem access permissions */
  filesystem: FilesystemBoundaries;
  /** Environment variable access */
  environment: EnvironmentBoundaries;
  /** Permission set for fine-grained control */
  permissions: PermissionSet;
  /** Rate limiting configuration */
  rateLimits: RateLimitConfig[];
  /** Cost limits for API calls */
  costLimits: CostLimits;
  /** Maximum output size in bytes */
  maxOutputSize: number;
  /** Maximum input size in bytes */
  maxInputSize: number;
  /** Allowed file extensions */
  allowedFileTypes: string[];
  /** Denied file extensions */
  deniedFileTypes: string[];
  /** Sandbox strictness level */
  strictness: 'permissive' | 'normal' | 'strict' | 'paranoid';
}

/**
 * Network access boundaries
 */
export interface NetworkBoundaries {
  /** Whether network access is allowed at all */
  enabled: boolean;
  /** Allowed hosts (supports wildcards like *.example.com) */
  allowedHosts: string[];
  /** Denied hosts (takes precedence) */
  deniedHosts: string[];
  /** Allowed ports */
  allowedPorts: number[];
  /** Denied ports */
  deniedPorts: number[];
  /** Maximum request size in bytes */
  maxRequestSize: number;
  /** Maximum response size in bytes */
  maxResponseSize: number;
  /** Request timeout in milliseconds */
  requestTimeout: number;
  /** Whether HTTPS is required */
  requireHttps: boolean;
  /** Maximum concurrent connections */
  maxConnections: number;
  /** Proxy configuration */
  proxy?: ProxyConfig;
  /** DNS settings */
  dns?: DNSConfig;
  /** Whether to allow WebSocket connections */
  allowWebSocket: boolean;
  /** Whether to allow HTTP/2 */
  allowHttp2: boolean;
}

/**
 * Filesystem access boundaries
 */
export interface FilesystemBoundaries {
  /** Whether filesystem access is allowed */
  enabled: boolean;
  /** Root directory for all file operations (chroot-like) */
  root: string;
  /** Allowed paths relative to root */
  allowedPaths: string[];
  /** Denied paths (takes precedence) */
  deniedPaths: string[];
  /** Whether writes are allowed */
  allowWrite: boolean;
  /** Whether deletes are allowed */
  allowDelete: boolean;
  /** Whether creates are allowed */
  allowCreate: boolean;
  /** Maximum file size in bytes */
  maxFileSize: number;
  /** Maximum total storage in bytes */
  maxStorage: number;
  /** Allowed file extensions */
  allowedExtensions: string[];
  /** Denied file extensions */
  deniedExtensions: string[];
  /** Whether symlinks are followed */
  followSymlinks: boolean;
  /** Whether hidden files are accessible */
  allowHiddenFiles: boolean;
  /** Maximum open file handles */
  maxOpenFiles: number;
  /** Temporary directory path */
  tempDir?: string;
}

/**
 * Environment variable boundaries
 */
export interface EnvironmentBoundaries {
  /** Whether environment access is allowed */
  enabled: boolean;
  /** Allowed environment variable names */
  allowedVars: string[];
  /** Denied variable names (takes precedence) */
  deniedVars: string[];
  /** Read-only variables */
  readOnlyVars: string[];
  /** Prefix pattern for allowed vars */
  allowedPrefix?: string;
}

/**
 * Permission set for fine-grained access control
 */
export interface PermissionSet {
  /** Granted permissions */
  granted: Set<Permission>;
  /** Denied permissions (takes precedence) */
  denied: Set<Permission>;
  /** Permission conditions (conditional grants) */
  conditions: Map<Permission, PermissionCondition>;
  /** Default allow policy */
  defaultAllow: boolean;
}

/**
 * Individual permission type
 */
export type Permission =
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'fs.create'
  | 'fs.list'
  | 'fs.watch'
  | 'network.http'
  | 'network.https'
  | 'network.websocket'
  | 'network.dns'
  | 'network.tcp'
  | 'network.udp'
  | 'exec.shell'
  | 'exec.code'
  | 'exec.binary'
  | 'memory.allocate'
  | 'env.read'
  | 'env.write'
  | 'process.fork'
  | 'process.kill'
  | 'process.list'
  | 'system.info'
  | 'system.time'
  | 'system.random'
  | 'tool.use'
  | 'tool.register'
  | 'mcp.connect'
  | 'mcp.expose'
  | string;

/**
 * Conditional permission grant
 */
export interface PermissionCondition {
  /** Condition expression */
  condition: string;
  /** Time window for permission validity */
  timeWindow?: { start: Date; end: Date };
  /** Usage limit */
  usageLimit?: number;
  /** Current usage count */
  currentUsage?: number;
  /** Additional constraints */
  constraints?: Record<string, unknown>;
  /** Whether to auto-revoke after limit */
  autoRevoke?: boolean;
}

// ============================================================================
// OUTPUT SCHEMA
// ============================================================================

/**
 * Output schema for structured agent responses
 */
export interface OutputSchema<T = unknown> {
  /** Zod schema or JSON Schema */
  schema: z.ZodType<T> | JSONSchema;
  /** Whether streaming output is supported */
  streaming: boolean;
  /** Transformation function for output */
  transform?: (output: unknown) => T;
  /** Validation mode */
  validation: 'strict' | 'lenient' | 'none';
  /** Default value if validation fails */
  fallback?: T;
  /** Whether to coerce types */
  coerce: boolean;
  /** Error handling strategy */
  onError: 'throw' | 'fallback' | 'partial';
}

/**
 * JSON Schema representation for LLM tool definitions
 */
export interface JSONSchema {
  $schema?: string;
  type: string | string[];
  properties?: Record<string, JSONSchema>;
  additionalProperties?: boolean | JSONSchema;
  patternProperties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema | JSONSchema[];
  prefixItems?: JSONSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  examples?: unknown[];
  pattern?: string;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;
  minProperties?: number;
  maxProperties?: number;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;
  if?: JSONSchema;
  then?: JSONSchema;
  else?: JSONSchema;
  $ref?: string;
  definitions?: Record<string, JSONSchema>;
  $defs?: Record<string, JSONSchema>;
  title?: string;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  contentMediaType?: string;
  contentEncoding?: string;
}

// ============================================================================
// EXECUTION STATE
// ============================================================================

/**
 * Current state of WRAP execution
 */
export interface ExecutionState {
  /** Current status */
  status: ExecutionStatus;
  /** Current step/phase */
  step: ExecutionStep;
  /** Progress percentage (0-100) */
  progress: number;
  /** Accumulated tokens */
  tokens: TokenUsage;
  /** Accumulated costs */
  costs: CostUsage;
  /** Tool call history */
  toolCalls: ToolCall[];
  /** Errors encountered */
  errors: ExecutionError[];
  /** Warnings generated */
  warnings: ExecutionWarning[];
  /** Execution timeline */
  timeline: TimelineEvent[];
  /** Checkpoints for resumption */
  checkpoints: Checkpoint[];
  /** Current position for streaming */
  cursor?: ExecutionCursor;
  /** Number of iterations */
  iterations: number;
  /** Started at timestamp */
  startedAt?: Date;
  /** Completed at timestamp */
  completedAt?: Date;
  /** Total duration in ms */
  duration?: number;
}

/**
 * Execution status
 */
export type ExecutionStatus =
  | 'pending'
  | 'queued'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'resuming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'rate_limited';

/**
 * Execution step/phase
 */
export type ExecutionStep =
  | 'setup'
  | 'validation'
  | 'context_loading'
  | 'tool_resolution'
  | 'boundary_check'
  | 'permission_check'
  | 'agent_thinking'
  | 'tool_execution'
  | 'output_generation'
  | 'validation_output'
  | 'cleanup'
  | 'done';

/**
 * Token usage tracking
 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  cached: number;
  byModel: Map<string, { prompt: number; completion: number }>;
  limit?: number;
  remaining?: number;
}

/**
 * Cost tracking
 */
export interface CostUsage {
  input: number;
  output: number;
  total: number;
  currency: string;
  byModel: Map<string, { input: number; output: number }>;
  limit?: number;
  remaining?: number;
}

/**
 * Execution error
 */
export interface ExecutionError {
  id: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
  timestamp: Date;
  recoverable: boolean;
  recoveryAction?: string;
  retryCount?: number;
  source?: 'agent' | 'tool' | 'system' | 'boundary' | 'permission';
}

/**
 * Execution warning
 */
export interface ExecutionWarning {
  id: string;
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  dismissed: boolean;
}

/**
 * Timeline event for execution history
 */
export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: Date;
  duration?: number;
  data?: Record<string, unknown>;
}

/**
 * Timeline event types
 */
export type TimelineEventType =
  | 'execution_start'
  | 'execution_end'
  | 'step_start'
  | 'step_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_call_retry'
  | 'message_sent'
  | 'message_received'
  | 'stream_start'
  | 'stream_end'
  | 'stream_token'
  | 'checkpoint_created'
  | 'checkpoint_restored'
  | 'error_occurred'
  | 'error_recovered'
  | 'warning_raised'
  | 'boundary_violation'
  | 'permission_denied'
  | 'permission_granted'
  | 'rate_limit_hit'
  | 'rate_limit_reset'
  | 'cost_threshold_reached'
  | 'token_limit_reached'
  | 'state_change'
  | 'pause'
  | 'resume'
  | 'cancel';

/**
 * Checkpoint for execution resumption
 */
export interface Checkpoint {
  id: string;
  timestamp: Date;
  state: ExecutionState;
  context: AgentContext;
  description?: string;
  size: number;
  compressed: boolean;
}

/**
 * Cursor for streaming execution position
 */
export interface ExecutionCursor {
  position: number;
  total?: number;
  lastUpdate: Date;
  currentToken?: string;
}

// ============================================================================
// TELEMETRY
// ============================================================================

/**
 * Telemetry data for observability
 */
export interface TelemetryData {
  /** Trace ID for distributed tracing */
  traceId: string;
  /** Span ID for this execution */
  spanId: string;
  /** Parent span ID (if nested) */
  parentSpanId?: string;
  /** All spans in this trace */
  spans: Span[];
  /** Metrics collected */
  metrics: Metric[];
  /** Logs generated */
  logs: LogEntry[];
  /** Events emitted */
  events: TelemetryEvent[];
  /** Sampling decision */
  sampled: boolean;
  /** Baggage for context propagation */
  baggage?: Record<string, string>;
}

/**
 * OpenTelemetry span
 */
export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  attributes: Record<string, unknown>;
  status: { code: number; message?: string };
  events: SpanEvent[];
  links?: SpanLink[];
}

/**
 * Span event
 */
export interface SpanEvent {
  name: string;
  timestamp: Date;
  attributes?: Record<string, unknown>;
}

/**
 * Span link
 */
export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: Record<string, unknown>;
}

/**
 * Metric data point
 */
export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  value: number;
  timestamp: Date;
  attributes?: Record<string, unknown>;
  unit?: string;
  description?: string;
}

/**
 * Log entry
 */
export interface LogEntry {
  timestamp: Date;
  severity: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  attributes?: Record<string, unknown>;
  spanId?: string;
  traceId?: string;
}

/**
 * Telemetry event
 */
export interface TelemetryEvent {
  id: string;
  type: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

/**
 * Trace context for propagation
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: string;
}

// ============================================================================
// SANDBOX
// ============================================================================

/**
 * Sandbox information
 */
export interface SandboxInfo {
  id: string;
  type: SandboxType;
  status: SandboxStatus;
  resources: ResourceUsage;
  createdAt: Date;
  expiresAt?: Date;
  lastActivity?: Date;
  pid?: number;
  containerId?: string;
}

/**
 * Type of sandbox isolation
 */
export type SandboxType =
  | 'process'
  | 'container'
  | 'vm'
  | 'wasm'
  | 'v8'
  | 'firecracker'
  | 'gvisor'
  | 'kata'
  | 'none';

/**
 * Sandbox status
 */
export type SandboxStatus =
  | 'creating'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'resuming'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'expired'
  | 'evicted';

/**
 * Resource usage tracking
 */
export interface ResourceUsage {
  cpu: CpuUsage;
  memory: MemoryUsage;
  network: NetworkUsage;
  filesystem: FilesystemUsage;
  processes: ProcessUsage;
  gpu?: GpuUsage;
}

/**
 * CPU usage
 */
export interface CpuUsage {
  percentage: number;
  userTime: number;
  systemTime: number;
  cores: number;
  throttledTime?: number;
}

/**
 * Memory usage
 */
export interface MemoryUsage {
  used: number;
  total: number;
  percentage: number;
  peak: number;
  heap?: HeapUsage;
  rss?: number;
  cache?: number;
}

/**
 * Heap memory usage (for V8/Node)
 */
export interface HeapUsage {
  used: number;
  total: number;
  limit: number;
  external: number;
  arrayBuffers: number;
}

/**
 * Network usage
 */
export interface NetworkUsage {
  bytesSent: number;
  bytesReceived: number;
  requests: number;
  connections: number;
  errors: number;
  dnsLookups: number;
}

/**
 * Filesystem usage
 */
export interface FilesystemUsage {
  used: number;
  total: number;
  files: number;
  directories: number;
  reads: number;
  writes: number;
  errors: number;
}

/**
 * Process usage
 */
export interface ProcessUsage {
  count: number;
  threads: number;
  openFiles: number;
  openSockets: number;
  zombies: number;
}

/**
 * GPU usage
 */
export interface GpuUsage {
  device: string;
  memoryUsed: number;
  memoryTotal: number;
  utilization: number;
  temperature: number;
}

// ============================================================================
// VIRTUAL FILESYSTEM
// ============================================================================

/**
 * Virtual filesystem interface
 */
export interface VirtualFileSystem {
  readFile(path: string, encoding?: BufferEncoding): Promise<Buffer | string>;
  writeFile(path: string, data: Buffer | string, encoding?: BufferEncoding): Promise<void>;
  appendFile(path: string, data: Buffer | string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]>;
  copy(src: string, dst: string): Promise<void>;
  move(src: string, dst: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  symlink(target: string, path: string, type?: 'file' | 'dir' | 'junction'): Promise<void>;
  readlink(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  truncate(path: string, len?: number): Promise<void>;
  watch(path: string, options: WatchOptions): Promise<FileWatcher>;
  createReadStream(path: string, options?: StreamOptions): ReadableStream;
  createWriteStream(path: string, options?: StreamOptions): WritableStream;
  chmod(path: string, mode: number): Promise<void>;
  chown(path: string, uid: number, gid: number): Promise<void>;
  utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
}

/**
 * File statistics
 */
export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  isBlockDevice: boolean;
  isCharacterDevice: boolean;
  isFIFO: boolean;
  isSocket: boolean;
  size: number;
  blksize: number;
  blocks: number;
  createdAt: Date;
  modifiedAt: Date;
  accessedAt: Date;
  mode: number;
  uid: number;
  gid: number;
  ino: number;
  dev: number;
  nlink: number;
}

/**
 * Directory entry
 */
export interface Dirent {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/**
 * Watch options
 */
export interface WatchOptions {
  persistent?: boolean;
  recursive?: boolean;
  encoding?: BufferEncoding;
  signal?: AbortSignal;
}

/**
 * File watcher handle
 */
export interface FileWatcher {
  close(): void;
  pause(): void;
  resume(): void;
  add(path: string): void;
  unwatch(path: string): void;
}

/**
 * Stream options
 */
export interface StreamOptions {
  start?: number;
  end?: number;
  encoding?: BufferEncoding;
  highWaterMark?: number;
  flags?: string;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
}

// ============================================================================
// NETWORK ACCESS
// ============================================================================

/**
 * Network access interface
 */
export interface NetworkAccess {
  fetch(url: string, options?: FetchOptions): Promise<Response>;
  websocket(url: string, options?: WebSocketOptions): Promise<WebSocket>;
  dns: DNSAccess;
  http: HTTPClient;
  isAllowed(url: string): boolean;
  resolveHost(host: string): Promise<string[]>;
}

/**
 * DNS access
 */
export interface DNSAccess {
  resolve(hostname: string, rrType?: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string>;
  reverse(ip: string): Promise<string[]>;
  lookup(hostname: string, options?: { family?: number; hints?: number }): Promise<{ address: string; family: number }>;
}

/**
 * HTTP client interface
 */
export interface HTTPClient {
  get(url: string, options?: RequestOptions): Promise<Response>;
  post(url: string, body?: unknown, options?: RequestOptions): Promise<Response>;
  put(url: string, body?: unknown, options?: RequestOptions): Promise<Response>;
  patch(url: string, body?: unknown, options?: RequestOptions): Promise<Response>;
  delete(url: string, options?: RequestOptions): Promise<Response>;
  head(url: string, options?: RequestOptions): Promise<Response>;
  options(url: string, options?: RequestOptions): Promise<Response>;
  request(url: string, options: RequestOptions): Promise<Response>;
}

/**
 * Fetch options
 */
export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  redirect?: 'follow' | 'error' | 'manual';
  credentials?: 'omit' | 'same-origin' | 'include';
  cache?: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
  mode?: 'cors' | 'no-cors' | 'same-origin';
  referrer?: string;
  referrerPolicy?: string;
  integrity?: string;
  keepalive?: boolean;
}

/**
 * Request options
 */
export interface RequestOptions extends FetchOptions {
  params?: Record<string, string | number | boolean>;
  auth?: { username: string; password: string } | { bearer: string } | { token: string };
  retry?: RetryConfig;
  baseURL?: string;
  transformRequest?: (data: unknown, headers: Record<string, string>) => unknown;
  transformResponse?: (data: unknown) => unknown;
  validateStatus?: (status: number) => boolean;
  maxRedirects?: number;
  decompress?: boolean;
}

/**
 * WebSocket options
 */
export interface WebSocketOptions {
  headers?: Record<string, string>;
  protocols?: string[];
  timeout?: number;
  handshakeTimeout?: number;
  maxPayload?: number;
  followRedirects?: boolean;
}

// ============================================================================
// STREAMING
// ============================================================================

/**
 * Stream event for real-time updates
 */
export interface StreamEvent {
  id: string;
  type: StreamEventType;
  timestamp: Date;
  data: unknown;
  sequence?: number;
}

/**
 * Stream event types
 */
export type StreamEventType =
  | 'token'
  | 'tool_start'
  | 'tool_progress'
  | 'tool_end'
  | 'thinking'
  | 'reasoning'
  | 'error'
  | 'warning'
  | 'checkpoint'
  | 'state_change'
  | 'output'
  | 'complete'
  | 'delta'
  | 'log'
  | 'metric';

// ============================================================================
// LOGGING
// ============================================================================

/**
 * Logger interface
 */
export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  fatal(message: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): Logger;
  withPrefix(prefix: string): Logger;
  withLevel(level: LogLevel): Logger;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  isLevelEnabled(level: LogLevel): boolean;
}

/**
 * Log level
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Tool error
 */
export interface ToolError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  retryAfter?: number;
  suggestion?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
  data?: unknown;
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
  constraint?: string;
  keyword?: string;
  params?: Record<string, unknown>;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  path: string;
  message: string;
  value?: unknown;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  backoff: 'fixed' | 'exponential' | 'linear' | 'fibonacci';
  initialDelay: number;
  maxDelay: number;
  jitter: boolean;
  retryOn: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  window: number;
  maxRequests: number;
  key: string;
  strategy: 'sliding' | 'fixed' | 'token_bucket' | 'leaky_bucket';
  skipFailed?: boolean;
  skipSuccessful?: boolean;
}

/**
 * Cost limits
 */
export interface CostLimits {
  maxInputCost: number;
  maxOutputCost: number;
  maxTotalCost: number;
  currency: string;
  alertThresholds: number[];
  hardLimit: boolean;
}

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  http?: string;
  https?: string;
  noProxy?: string[];
  auth?: { username: string; password: string };
}

/**
 * DNS configuration
 */
export interface DNSConfig {
  servers?: string[];
  timeout?: number;
  attempts?: number;
  cache?: boolean;
  cacheTTL?: number;
}

// ============================================================================
// MODEL PROVIDER
// ============================================================================

/**
 * LLM Model provider configuration
 */
export interface ModelProvider {
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'vertex' | 'local' | 'custom';
  models: ModelConfig[];
  client: ModelClient;
  defaultModel?: string;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsJSON: boolean;
  inputPrice: number;
  outputPrice: number;
  capabilities: string[];
  deprecation?: { date: Date; replacement?: string };
}

/**
 * Model client interface
 */
export interface ModelClient {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  completeStream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
  embed(text: string | string[]): Promise<number[][]>;
  countTokens(text: string): number;
}

/**
 * Completion request
 */
export interface CompletionRequest {
  model: string;
  messages: Message[];
  tools?: Tool[];
  toolChoice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  responseFormat?: { type: 'text' | 'json_object' | 'json_schema'; schema?: JSONSchema };
  seed?: number;
  user?: string;
  logprobs?: boolean;
  topLogprobs?: number;
  n?: number;
  stream?: boolean;
}

/**
 * Completion response
 */
export interface CompletionResponse {
  id: string;
  model: string;
  message: Message;
  usage: TokenUsage;
  finishReason: FinishReason;
  systemFingerprint?: string;
  created?: number;
}

/**
 * Completion chunk for streaming
 */
export interface CompletionChunk {
  id: string;
  model: string;
  delta: Partial<Message>;
  usage?: Partial<TokenUsage>;
  finishReason?: FinishReason;
  index?: number;
  logprobs?: unknown;
}

// ============================================================================
// BRAND
// ============================================================================

export const WRAPBrand = {
  PRIMITIVE: 'WRAP = Context + Tools + Boundaries + Output',
  VERSION: '1.0.0',
  PROTOCOL: 'NEBULA',
  TAGLINE: 'Run anything, anywhere, locally, with zero trust',
  REPO: 'https://github.com/wrap-ai/wrap-nebula'
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  WRAP,
  AgentContext,
  Message,
  MessageRole,
  MessageContent,
  ContentPart,
  MessageMetadata,
  MessageStatus,
  FinishReason,
  Tool,
  ToolHandler,
  ToolContext,
  ToolCall,
  ToolCallStatus,
  ToolRegistry,
  ToolSchema,
  ToolMetadata,
  ToolExample,
  ToolCost,
  Boundaries,
  NetworkBoundaries,
  FilesystemBoundaries,
  EnvironmentBoundaries,
  PermissionSet,
  Permission,
  PermissionCondition,
  OutputSchema,
  JSONSchema,
  ExecutionState,
  ExecutionStatus,
  ExecutionStep,
  TokenUsage,
  CostUsage,
  ExecutionError,
  ExecutionWarning,
  TimelineEvent,
  TimelineEventType,
  Checkpoint,
  ExecutionCursor,
  TelemetryData,
  Span,
  SpanEvent,
  SpanLink,
  Metric,
  LogEntry,
  TelemetryEvent,
  TraceContext,
  SandboxInfo,
  SandboxType,
  SandboxStatus,
  ResourceUsage,
  CpuUsage,
  MemoryUsage,
  HeapUsage,
  NetworkUsage,
  FilesystemUsage,
  ProcessUsage,
  GpuUsage,
  VirtualFileSystem,
  FileStat,
  Dirent,
  WatchOptions,
  FileWatcher,
  StreamOptions,
  NetworkAccess,
  DNSAccess,
  HTTPClient,
  FetchOptions,
  RequestOptions,
  WebSocketOptions,
  StreamEvent,
  StreamEventType,
  Logger,
  LogLevel,
  ToolError,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  RetryConfig,
  RateLimitConfig,
  CostLimits,
  ProxyConfig,
  DNSConfig,
  ModelProvider,
  ModelConfig,
  ModelClient,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk
};

/**
 * @fileoverview Complete type definitions for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/types
 * @description This module contains all TypeScript type definitions, interfaces,
 * and type aliases used throughout the WRAP Nebula SDK. These types provide
 * strict type safety and comprehensive documentation for all SDK operations.
 */

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Makes specified keys of T required
 * @template T - The type to modify
 * @template K - The keys to make required
 */
export type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Makes specified keys of T optional
 * @template T - The type to modify
 * @template K - The keys to make optional
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Deep partial type that recursively applies Partial
 * @template T - The type to make deeply partial
 */
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

/**
 * Deep required type that recursively applies Required
 * @template T - The type to make deeply required
 */
export type DeepRequired<T> = T extends object ? {
  [P in keyof T]-?: DeepRequired<T[P]>;
} : T;

/**
 * Deep readonly type that recursively applies Readonly
 * @template T - The type to make deeply readonly
 */
export type DeepReadonly<T> = T extends object ? {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
} : T;

/**
 * Extract the element type from an array type
 * @template T - The array type
 */
export type ArrayElement<T> = T extends readonly (infer E)[] ? E : never;

/**
 * Make a type mutable by removing readonly modifiers
 * @template T - The type to make mutable
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * A type that can be a promise or a direct value
 * @template T - The value type
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * A type that can be null or undefined
 * @template T - The value type
 */
export type Nullable<T> = T | null | undefined;

/**
 * A non-empty array type
 * @template T - The element type
 */
export type NonEmptyArray<T> = [T, ...T[]];

/**
 * A type-safe Object.keys return type
 * @template T - The object type
 */
export type ObjectKeys<T extends object> = `${Exclude<keyof T, symbol>}`;

/**
 * A type-safe Object.entries return type
 * @template T - The object type
 */
export type ObjectEntries<T extends object> = Array<
  [keyof T, T[keyof T]]
>;

/**
 * Branded type for nominal typing
 * @template T - The underlying type
 * @template B - The brand symbol
 */
export type Branded<T, B extends symbol> = T & { readonly __brand: B };

/**
 * Extract function parameter types as a tuple
 * @template T - The function type
 */
export type Parameters<T extends (...args: unknown[]) => unknown> = T extends (
  ...args: infer P
) => unknown ? P : never;

/**
 * Extract function return type
 * @template T - The function type
 */
export type ReturnType<T extends (...args: unknown[]) => unknown> = T extends (
  ...args: unknown[]
) => infer R ? R : never;

/**
 * Extract the awaited return type of a function
 * @template T - The function type
 */
export type AwaitedReturnType<T extends (...args: unknown[]) => unknown> = Awaited<
  ReturnType<T>
>;

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Represents the role of a message sender
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

/**
 * Represents the status of a message
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'cancelled';

/**
 * Base interface for all message types
 * @description Provides common properties shared by all message variants
 */
export interface BaseMessage {
  /** Unique identifier for the message */
  id: string;
  /** Role of the message sender */
  role: MessageRole;
  /** Current status of the message */
  status: MessageStatus;
  /** Timestamp when the message was created */
  createdAt: Date;
  /** Timestamp when the message was last updated */
  updatedAt: Date;
  /** Optional metadata associated with the message */
  metadata?: MessageMetadata;
}

/**
 * Metadata associated with a message
 */
export interface MessageMetadata {
  /** Source of the message */
  source?: string;
  /** Confidence score for generated content */
  confidence?: number;
  /** Model used to generate the message */
  model?: string;
  /** Provider that generated the message */
  provider?: string;
  /** Token count for the message */
  tokenCount?: number;
  /** Custom key-value pairs */
  custom?: Record<string, unknown>;
  /** Request ID for tracing */
  requestId?: string;
  /** Session ID for grouping */
  sessionId?: string;
}

/**
 * System message for providing instructions
 */
export interface SystemMessage extends BaseMessage {
  role: 'system';
  /** The system instruction content */
  content: string;
  /** Optional name for the system message */
  name?: string;
}

/**
 * User message from the human user
 */
export interface UserMessage extends BaseMessage {
  role: 'user';
  /** The user message content */
  content: UserContent;
  /** Optional name of the user */
  name?: string;
}

/**
 * Content types that can appear in a user message
 */
export type UserContent = string | ContentPart[];

/**
 * Represents a single part of multi-modal content
 */
export interface ContentPart {
  /** Type of the content part */
  type: 'text' | 'image' | 'audio' | 'video' | 'file';
  /** Text content for text type */
  text?: string;
  /** Image URL for image type */
  imageUrl?: ImageUrl;
  /** Image data as base64 for image type */
  imageData?: ImageData;
  /** Audio data for audio type */
  audioData?: AudioData;
  /** Video data for video type */
  videoData?: VideoData;
  /** File attachment for file type */
  fileData?: FileData;
}

/**
 * Image URL reference
 */
export interface ImageUrl {
  /** URL to the image */
  url: string;
  /** Optional detail level */
  detail?: 'auto' | 'low' | 'high';
}

/**
 * Base64 encoded image data
 */
export interface ImageData {
  /** Base64 encoded image data */
  base64: string;
  /** MIME type of the image */
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/**
 * Audio data structure
 */
export interface AudioData {
  /** Base64 encoded audio data */
  base64: string;
  /** MIME type of the audio */
  mimeType: 'audio/mp3' | 'audio/wav' | 'audio/ogg' | 'audio/mpeg';
}

/**
 * Video data structure
 */
export interface VideoData {
  /** Base64 encoded video data */
  base64: string;
  /** MIME type of the video */
  mimeType: 'video/mp4' | 'video/webm' | 'video/ogg';
}

/**
 * File attachment data
 */
export interface FileData {
  /** Base64 encoded file data */
  base64: string;
  /** Original filename */
  filename: string;
  /** MIME type of the file */
  mimeType: string;
}

/**
 * Assistant message from the AI
 */
export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  /** The assistant message content */
  content: string | AssistantContentPart[];
  /** Tool calls made by the assistant */
  toolCalls?: ToolCall[];
  /** Function calls (legacy format) */
  functionCall?: FunctionCall;
  /** Reasoning content (for models that support it) */
  reasoning?: string;
  /** Model that generated this response */
  model?: string;
}

/**
 * Content parts that can appear in an assistant message
 */
export interface AssistantContentPart {
  /** Type of the content part */
  type: 'text' | 'refusal' | 'tool_use';
  /** Text content */
  text?: string;
  /** Refusal message */
  refusal?: string;
  /** Tool use information */
  toolUse?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
}

/**
 * Tool call from an assistant
 */
export interface ToolCall {
  /** Unique identifier for the tool call */
  id: string;
  /** Type of the tool call */
  type: 'function' | 'code_interpreter' | 'retrieval';
  /** Function call details */
  function: {
    /** Name of the function to call */
    name: string;
    /** Arguments as a JSON string */
    arguments: string;
  };
}

/**
 * Legacy function call format
 */
export interface FunctionCall {
  /** Name of the function */
  name: string;
  /** Arguments as a JSON string */
  arguments: string;
}

/**
 * Tool result message
 */
export interface ToolMessage extends BaseMessage {
  role: 'tool';
  /** ID of the tool call this is responding to */
  toolCallId: string;
  /** The tool result content */
  content: string;
  /** Whether the tool execution was successful */
  success: boolean;
  /** Error message if the tool execution failed */
  error?: string;
  /** Execution time in milliseconds */
  executionTime?: number;
}

/**
 * Union type of all message types
 */
export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

/**
 * Type guard for system messages
 */
export function isSystemMessage(message: Message): message is SystemMessage {
  return message.role === 'system';
}

/**
 * Type guard for user messages
 */
export function isUserMessage(message: Message): message is UserMessage {
  return message.role === 'user';
}

/**
 * Type guard for assistant messages
 */
export function isAssistantMessage(message: Message): message is AssistantMessage {
  return message.role === 'assistant';
}

/**
 * Type guard for tool messages
 */
export function isToolMessage(message: Message): message is ToolMessage {
  return message.role === 'tool';
}

// ============================================================================
// TOOL TYPES
// ============================================================================

/**
 * Represents the type of a tool parameter
 */
export type ToolParameterType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

/**
 * JSON Schema for tool parameters
 */
export interface ToolParameterSchema {
  /** Type of the parameter */
  type: ToolParameterType | ToolParameterType[];
  /** Description of the parameter */
  description?: string;
  /** Default value for the parameter */
  default?: unknown;
  /** Whether the parameter is required */
  required?: boolean;
  /** Enum values for string types */
  enum?: string[];
  /** Minimum value for number types */
  minimum?: number;
  /** Maximum value for number types */
  maximum?: number;
  /** Minimum length for string types */
  minLength?: number;
  /** Maximum length for string types */
  maxLength?: number;
  /** Pattern for string types */
  pattern?: string;
  /** Format for string types */
  format?: string;
  /** Items schema for array types */
  items?: ToolParameterSchema;
  /** Properties for object types */
  properties?: Record<string, ToolParameterSchema>;
  /** Additional properties for object types */
  additionalProperties?: boolean | ToolParameterSchema;
  /** Schema reference */
  $ref?: string;
  /** One of schemas */
  oneOf?: ToolParameterSchema[];
  /** Any of schemas */
  anyOf?: ToolParameterSchema[];
  /** All of schemas */
  allOf?: ToolParameterSchema[];
}

/**
 * Complete tool definition
 */
export interface ToolDefinition {
  /** Unique identifier for the tool */
  id: string;
  /** Name of the tool */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** Version of the tool */
  version?: string;
  /** Category for grouping tools */
  category?: string;
  /** Tags for searching/filtering tools */
  tags?: string[];
  /** Input parameter schema */
  parameters: ToolParameterSchema;
  /** Output schema for the tool */
  outputSchema?: ToolParameterSchema;
  /** Whether the tool is dangerous */
  dangerous?: boolean;
  /** Required permissions to use the tool */
  requiredPermissions?: Permission[];
  /** Estimated execution time in ms */
  estimatedExecutionTime?: number;
  /** Whether the tool supports streaming */
  supportsStreaming?: boolean;
  /** Whether the tool is stateful */
  stateful?: boolean;
  /** Author of the tool */
  author?: string;
  /** Documentation URL */
  documentationUrl?: string;
  /** Examples of tool usage */
  examples?: ToolExample[];
  /** Deprecation message if deprecated */
  deprecated?: string;
}

/**
 * Example of tool usage
 */
export interface ToolExample {
  /** Description of the example */
  description: string;
  /** Input parameters for the example */
  input: Record<string, unknown>;
  /** Expected output for the example */
  output?: unknown;
}

/**
 * Context provided to tool execution
 */
export interface ToolExecutionContext {
  /** Unique execution ID */
  executionId: string;
  /** ID of the agent executing the tool */
  agentId: string;
  /** ID of the sandbox environment */
  sandboxId: string;
  /** Requested permissions */
  permissions: Permission[];
  /** Current boundaries */
  boundaries: Boundaries;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Logger instance */
  logger?: ToolLogger;
  /** Telemetry context */
  telemetry?: TelemetryContext;
  /** Custom context data */
  custom?: Record<string, unknown>;
}

/**
 * Logger interface for tool execution
 */
export interface ToolLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Telemetry context for tool execution
 */
export interface TelemetryContext {
  /** Trace ID */
  traceId: string;
  /** Span ID */
  spanId: string;
  /** Parent span ID */
  parentSpanId?: string;
  /** Custom attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Result of a tool execution
 */
export interface ToolResult {
  /** Unique execution ID */
  executionId: string;
  /** Tool call ID */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Result content */
  content: unknown;
  /** Error message if failed */
  error?: ToolExecutionError;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Token usage if applicable */
  tokenUsage?: TokenUsage;
  /** Metadata about the execution */
  metadata?: Record<string, unknown>;
}

/**
 * Error details for tool execution
 */
export interface ToolExecutionError {
  /** Error type */
  type: 'validation' | 'permission' | 'timeout' | 'execution' | 'unknown';
  /** Error message */
  message: string;
  /** Stack trace */
  stack?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Whether the error is retryable */
  retryable: boolean;
  /** Suggested recovery action */
  recoveryAction?: string;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  /** Prompt tokens used */
  promptTokens: number;
  /** Completion tokens used */
  completionTokens: number;
  /** Total tokens used */
  totalTokens: number;
}

/**
 * Handler function type for tools
 */
export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<TOutput>;

/**
 * Validation function type for tool input
 */
export type ToolValidator<TInput = unknown> = (
  input: unknown
) => TInput | Promise<TInput>;

/**
 * Tool creation options
 */
export interface ToolOptions<TInput = unknown, TOutput = unknown> {
  /** Tool definition */
  definition: ToolDefinition;
  /** Handler function */
  handler: ToolHandler<TInput, TOutput>;
  /** Input validator */
  validator?: ToolValidator<TInput>;
  /** Pre-execution hook */
  preExecute?: (input: TInput, context: ToolExecutionContext) => MaybePromise<void>;
  /** Post-execution hook */
  postExecute?: (
    result: ToolResult,
    context: ToolExecutionContext
  ) => MaybePromise<void>;
  /** Error handler */
  onError?: (error: Error, context: ToolExecutionContext) => MaybePromise<void>;
}

// ============================================================================
// BOUNDARIES TYPES
// ============================================================================

/**
 * Resource boundaries for sandbox execution
 */
export interface Boundaries {
  /** Memory limit in bytes */
  memoryLimit: number;
  /** CPU time limit in milliseconds */
  cpuTimeLimit: number;
  /** Wall clock time limit in milliseconds */
  wallTimeLimit: number;
  /** Network access settings */
  networkAccess: NetworkAccess;
  /** File system access settings */
  fileSystemAccess: FileSystemAccess;
  /** Process execution settings */
  processExecution: ProcessExecution;
  /** Environment variable restrictions */
  environmentVariables: EnvironmentVariableRestrictions;
  /** Custom boundaries */
  custom?: Record<string, BoundaryValue>;
}

/**
 * Network access configuration
 */
export interface NetworkAccess {
  /** Whether network access is allowed */
  allowed: boolean;
  /** Allowed hosts */
  allowedHosts?: string[];
  /** Blocked hosts */
  blockedHosts?: string[];
  /** Allowed ports */
  allowedPorts?: number[];
  /** Blocked ports */
  blockedPorts?: number[];
  /** Allowed protocols */
  allowedProtocols?: ('http' | 'https' | 'ws' | 'wss')[];
  /** Maximum request size in bytes */
  maxRequestSize?: number;
  /** Maximum response size in bytes */
  maxResponseSize?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Maximum concurrent connections */
  maxConcurrentConnections?: number;
  /** DNS resolution settings */
  dnsResolution?: DnsResolution;
}

/**
 * DNS resolution configuration
 */
export interface DnsResolution {
  /** Whether DNS resolution is allowed */
  allowed: boolean;
  /** Custom DNS servers */
  servers?: string[];
  /** Host overrides */
  overrides?: Record<string, string>;
}

/**
 * File system access configuration
 */
export interface FileSystemAccess {
  /** Whether file system access is allowed */
  allowed: boolean;
  /** Allowed paths for reading */
  allowedReadPaths?: string[];
  /** Allowed paths for writing */
  allowedWritePaths?: string[];
  /** Blocked paths */
  blockedPaths?: string[];
  /** Maximum file size in bytes */
  maxFileSize?: number;
  /** Maximum total storage in bytes */
  maxTotalStorage?: number;
  /** Whether to allow symbolic links */
  allowSymlinks?: boolean;
  /** Whether to allow hidden files */
  allowHiddenFiles?: boolean;
  /** File permissions */
  filePermissions?: FilePermissions;
}

/**
 * File permission settings
 */
export interface FilePermissions {
  /** Default permissions for new files */
  defaultMode?: string;
  /** Whether to allow execute permission */
  allowExecute?: boolean;
  /** Whether to allow chmod */
  allowChmod?: boolean;
  /** Whether to allow chown */
  allowChown?: boolean;
}

/**
 * Process execution configuration
 */
export interface ProcessExecution {
  /** Whether process execution is allowed */
  allowed: boolean;
  /** Allowed commands */
  allowedCommands?: string[];
  /** Blocked commands */
  blockedCommands?: string[];
  /** Whether to allow shell execution */
  allowShell?: boolean;
  /** Maximum processes that can be spawned */
  maxProcesses?: number;
  /** Process timeout in milliseconds */
  processTimeout?: number;
  /** Maximum output size in bytes */
  maxOutputSize?: number;
  /** Environment variable inheritance */
  inheritEnvironment?: boolean;
  /** User to run processes as */
  runAsUser?: string;
  /** Working directory for processes */
  workingDirectory?: string;
}

/**
 * Environment variable restrictions
 */
export interface EnvironmentVariableRestrictions {
  /** Whether environment variables are allowed */
  allowed: boolean;
  /** Allowed environment variables */
  allowedVars?: string[];
  /** Blocked environment variables */
  blockedVars?: string[];
  /** Required environment variables */
  requiredVars?: string[];
  /** Default environment variables */
  defaults?: Record<string, string>;
  /** Whether to inherit parent environment */
  inheritParent?: boolean;
}

/**
 * Boundary value type
 */
export interface BoundaryValue {
  /** Value type */
  type: 'number' | 'string' | 'boolean' | 'object' | 'array';
  /** Current value */
  value: unknown;
  /** Minimum value for numbers */
  min?: number;
  /** Maximum value for numbers */
  max?: number;
  /** Unit of measurement */
  unit?: string;
  /** Description of the boundary */
  description?: string;
}

/**
 * Boundary violation details
 */
export interface BoundaryViolation {
  /** Type of boundary that was violated */
  type: keyof Boundaries | 'custom';
  /** Name of the specific boundary */
  name: string;
  /** Current value that violated the boundary */
  currentValue: unknown;
  /** Limit that was exceeded */
  limit: unknown;
  /** Severity of the violation */
  severity: 'warning' | 'error' | 'critical';
  /** Timestamp of the violation */
  timestamp: Date;
  /** Suggested action */
  suggestedAction?: string;
}

// ============================================================================
// PERMISSION TYPES
// ============================================================================

/**
 * Permission definition
 */
export interface Permission {
  /** Unique permission identifier */
  id: string;
  /** Permission name */
  name: string;
  /** Permission description */
  description?: string;
  /** Permission category */
  category?: string;
  /** Permission scope */
  scope: PermissionScope;
  /** Whether the permission is dangerous */
  dangerous?: boolean;
  /** Resource patterns for the permission */
  resources?: string[];
  /** Actions allowed by this permission */
  actions?: PermissionAction[];
  /** Conditions for the permission */
  conditions?: PermissionCondition[];
  /** Expiration time */
  expiresAt?: Date;
}

/**
 * Permission scope types
 */
export type PermissionScope =
  | 'global'
  | 'sandbox'
  | 'tool'
  | 'resource'
  | 'custom';

/**
 * Permission action types
 */
export type PermissionAction =
  | 'read'
  | 'write'
  | 'execute'
  | 'delete'
  | 'create'
  | 'admin'
  | 'grant'
  | 'revoke';

/**
 * Permission condition
 */
export interface PermissionCondition {
  /** Condition type */
  type: 'time' | 'location' | 'resource' | 'custom';
  /** Condition operator */
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in' | 'matches';
  /** Condition value */
  value: unknown;
  /** Description of the condition */
  description?: string;
}

/**
 * Permission grant
 */
export interface PermissionGrant {
  /** Grant ID */
  id: string;
  /** Permission being granted */
  permissionId: string;
  /** Entity receiving the permission */
  grantee: string;
  /** Entity granting the permission */
  grantor: string;
  /** When the grant was created */
  grantedAt: Date;
  /** When the grant expires */
  expiresAt?: Date;
  /** Whether the grant is revocable */
  revocable: boolean;
  /** Conditions for the grant */
  conditions?: PermissionCondition[];
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  /** Whether the permission is granted */
  granted: boolean;
  /** Permission that was checked */
  permission: Permission;
  /// Reason for the result
  reason?: string;
  /** Conditions that were evaluated */
  evaluatedConditions?: PermissionCondition[];
  /** Whether the permission is temporary */
  temporary?: boolean;
  /** Expiration time if temporary */
  expiresAt?: Date;
}

/**
 * Permission request
 */
export interface PermissionRequest {
  /** Request ID */
  id: string;
  /** Permission being requested */
  permission: Permission;
  /// Requester identifier
  requester: string;
  /// Reason for the request
  reason?: string;
  /// When the request was made
  requestedAt: Date;
  /// Request status
  status: 'pending' | 'approved' | 'denied' | 'expired';
  /// Approver identifier
  approver?: string;
  /// Approval/denial reason
  decisionReason?: string;
  /// When the request was decided
  decidedAt?: Date;
}

// ============================================================================
// EXECUTION STATE TYPES
// ============================================================================

/**
 * Execution state of a sandbox or tool
 */
export type ExecutionState =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'error';

/**
 * Execution result
 */
export interface ExecutionResult<T = unknown> {
  /** Unique execution ID */
  executionId: string;
  /// Execution state
  state: ExecutionState;
  /// Result value if successful
  result?: T;
  /// Error if failed
  error?: ExecutionError;
  /// Start time
  startedAt: Date;
  /// End time
  endedAt?: Date;
  /// Execution duration in milliseconds
  duration?: number;
  /// Resource usage during execution
  resourceUsage?: ResourceUsage;
  /// Telemetry data
  telemetry?: TelemetryData;
}

/**
 * Execution error details
 */
export interface ExecutionError {
  /// Error type
  type: 'runtime' | 'timeout' | 'memory' | 'permission' | 'validation' | 'unknown';
  /// Error message
  message: string;
  /// Stack trace
  stack?: string;
  /// Error code
  code?: string;
  /// Whether the error is retryable
  retryable: boolean;
  /// Additional details
  details?: Record<string, unknown>;
}

/**
 * Resource usage statistics
 */
export interface ResourceUsage {
  /// CPU time used in milliseconds
  cpuTimeMs: number;
  /// Wall clock time in milliseconds
  wallTimeMs: number;
  /// Memory used in bytes
  memoryBytes: number;
  /// Peak memory usage in bytes
  peakMemoryBytes: number;
  /// Number of file operations
  fileOperations?: number;
  /// Number of network requests
  networkRequests?: number;
  /// Bytes read from disk
  bytesRead?: number;
  /// Bytes written to disk
  bytesWritten?: number;
  /// Bytes sent over network
  bytesSent?: number;
  /// Bytes received over network
  bytesReceived?: number;
}

// ============================================================================
// TELEMETRY TYPES
// ============================================================================

/**
 * Telemetry data collected during execution
 */
export interface TelemetryData {
  /// Trace ID for distributed tracing
  traceId: string;
  /// Span ID for this operation
  spanId: string;
  /// Parent span ID if this is a child operation
  parentSpanId?: string;
  /// Operation name
  operationName: string;
  /// Start time
  startTime: Date;
  /// End time
  endTime?: Date;
  /// Duration in milliseconds
  durationMs?: number;
  /// Status of the operation
  status: 'ok' | 'error' | 'cancelled';
  /// Attributes for the span
  attributes?: Record<string, unknown>;
  /// Events recorded during execution
  events?: TelemetryEvent[];
  /// Links to related spans
  links?: TelemetryLink[];
  /// Resource information
  resource?: TelemetryResource;
}

/**
 * Telemetry event
 */
export interface TelemetryEvent {
  /// Event name
  name: string;
  /// Event timestamp
  timestamp: Date;
  /// Event attributes
  attributes?: Record<string, unknown>;
}

/**
 * Telemetry link to another span
 */
export interface TelemetryLink {
  /// Linked trace ID
  traceId: string;
  /// Linked span ID
  spanId: string;
  /// Link attributes
  attributes?: Record<string, unknown>;
}

/**
 * Telemetry resource information
 */
export interface TelemetryResource {
  /// Service name
  serviceName: string;
  /// Service version
  serviceVersion?: string;
  /// Service instance ID
  serviceInstanceId?: string;
  /// Hostname
  hostname?: string;
  /// Host architecture
  hostArch?: string;
  /// OS type
  osType?: string;
  /// OS version
  osVersion?: string;
  /// Process ID
  processPid?: number;
  /// Custom attributes
  attributes?: Record<string, unknown>;
}

/**
 * Metric types for telemetry
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

/**
 * Metric definition
 */
export interface MetricDefinition {
  /// Metric name
  name: string;
  /// Metric type
  type: MetricType;
  /// Metric description
  description?: string;
  /// Metric unit
  unit?: string;
  /// Label keys for dimensions
  labelKeys?: string[];
}

/**
 * Metric data point
 */
export interface MetricDataPoint {
  /// Metric name
  name: string;
  /// Value
  value: number;
  /// Timestamp
  timestamp: Date;
  /// Labels for dimensions
  labels?: Record<string, string>;
  /// Min value for histograms
  min?: number;
  /// Max value for histograms
  max?: number;
  /// Sum for histograms
  sum?: number;
  /// Count for histograms
  count?: number;
  /// Bucket boundaries for histograms
  bucketCounts?: number[];
}

// ============================================================================
// SANDBOX TYPES
// ============================================================================

/**
 * Sandbox isolation type
 */
export type SandboxIsolationType =
  | 'none'
  | 'v8'
  | 'vm'
  | 'worker'
  | 'container'
  | 'process'
  | 'remote';

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  /// Unique sandbox identifier
  id: string;
  /// Isolation type
  isolationType: SandboxIsolationType;
  /// Resource boundaries
  boundaries: Boundaries;
  /// Permissions granted to the sandbox
  permissions: Permission[];
  /// Environment variables
  environment?: Record<string, string>;
  /// Working directory
  workingDirectory?: string;
  /// Timeout for operations in milliseconds
  timeout?: number;
  /// Whether to auto-destroy on completion
  autoDestroy?: boolean;
  /// Initial state to preload
  initialState?: SandboxState;
  /// Hooks for lifecycle events
  hooks?: SandboxHooks;
  /// Custom configuration
  custom?: Record<string, unknown>;
}

/**
 * Sandbox state
 */
export interface SandboxState {
  /// Global variables
  globals?: Record<string, unknown>;
  /// Module cache
  modules?: Record<string, unknown>;
  /// File system state
  fileSystem?: Record<string, string>;
  /// Custom state
  custom?: Record<string, unknown>;
}

/**
 * Sandbox lifecycle hooks
 */
export interface SandboxHooks {
  /// Called before sandbox creation
  beforeCreate?: (config: SandboxConfig) => MaybePromise<void>;
  /// Called after sandbox creation
  afterCreate?: (sandbox: SandboxInfo) => MaybePromise<void>;
  /// Called before code execution
  beforeExecute?: (code: string, context: ExecutionContext) => MaybePromise<void>;
  /// Called after code execution
  afterExecute?: (result: ExecutionResult) => MaybePromise<void>;
  /// Called on error
  onError?: (error: Error, context: ExecutionContext) => MaybePromise<void>;
  /// Called before sandbox destruction
  beforeDestroy?: (sandbox: SandboxInfo) => MaybePromise<void>;
  /// Called after sandbox destruction
  afterDestroy?: (sandboxId: string) => MaybePromise<void>;
}

/**
 * Execution context for sandbox operations
 */
export interface ExecutionContext {
  /// Execution ID
  executionId: string;
  /// Sandbox ID
  sandboxId: string;
  /// Code being executed
  code: string;
  /// Arguments for execution
  args?: unknown[];
  /// Boundaries for this execution
  boundaries: Boundaries;
  /// Permissions for this execution
  permissions: Permission[];
  /// Abort signal for cancellation
  abortSignal?: AbortSignal;
  /// Custom context
  custom?: Record<string, unknown>;
}

/**
 * Sandbox information
 */
export interface SandboxInfo {
  /// Unique sandbox identifier
  id: string;
  /// Isolation type
  isolationType: SandboxIsolationType;
  /// Current state
  state: ExecutionState;
  /// Creation timestamp
  createdAt: Date;
  /// Last activity timestamp
  lastActivityAt: Date;
  /// Current resource usage
  resourceUsage: ResourceUsage;
  /// Configuration
  config: SandboxConfig;
  /// Metrics collected
  metrics?: MetricDataPoint[];
  /// Health status
  health: SandboxHealth;
}

/**
 * Sandbox health status
 */
export interface SandboxHealth {
  /// Overall health status
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  /// Health check timestamp
  checkedAt: Date;
  /// Health issues detected
  issues?: SandboxHealthIssue[];
  /// Resource pressure
  resourcePressure?: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
}

/**
 * Sandbox health issue
 */
export interface SandboxHealthIssue {
  /// Issue type
  type: 'memory_pressure' | 'cpu_pressure' | 'disk_pressure' | 'network_issue' | 'custom';
  /// Severity
  severity: 'info' | 'warning' | 'error' | 'critical';
  /// Issue message
  message: string;
  /// Detected at timestamp
  detectedAt: Date;
  /// Suggested resolution
  resolution?: string;
}

// ============================================================================
// AGENT TYPES
// ============================================================================

/**
 * LLM provider types
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'meta' | 'local' | 'custom';

/**
 * Agent configuration
 */
export interface AgentConfig {
  /// Unique agent identifier
  id: string;
  /// Agent name
  name: string;
  /// Agent description
  description?: string;
  /// LLM provider to use
  provider: LLMProvider;
  /// Model identifier
  model: string;
  /// System prompt for the agent
  systemPrompt?: string;
  /// Temperature for generation
  temperature?: number;
  /// Maximum tokens for generation
  maxTokens?: number;
  /// Top-p sampling parameter
  topP?: number;
  /// Frequency penalty
  frequencyPenalty?: number;
  /// Presence penalty
  presencePenalty?: number;
  /// Stop sequences
  stopSequences?: string[];
  /// Tools available to the agent
  tools?: ToolDefinition[];
  /// Sandbox configuration
  sandbox?: SandboxConfig;
  /// Safety boundaries
  boundaries?: Boundaries;
  /// Permissions
  permissions?: Permission[];
  /// Maximum conversation turns
  maxConversationTurns?: number;
  /// Context window size
  contextWindowSize?: number;
  /// Memory configuration
  memory?: AgentMemoryConfig;
  /// Hooks for agent lifecycle
  hooks?: AgentHooks;
  /// Provider-specific options
  providerOptions?: Record<string, unknown>;
  /// Custom configuration
  custom?: Record<string, unknown>;
}

/**
 * Agent memory configuration
 */
export interface AgentMemoryConfig {
  /// Whether memory is enabled
  enabled: boolean;
  /// Maximum memories to store
  maxMemories?: number;
  /// Memory TTL in seconds
  ttl?: number;
  /// Memory importance threshold
  importanceThreshold?: number;
  /// Whether to use semantic search
  semanticSearch?: boolean;
  /// Embedding model for semantic search
  embeddingModel?: string;
}

/**
 * Agent lifecycle hooks
 */
export interface AgentHooks {
  /// Called before agent starts
  beforeStart?: (context: AgentContext) => MaybePromise<void>;
  /// Called after agent completes
  afterComplete?: (result: AgentResult) => MaybePromise<void>;
  /// Called on each message
  onMessage?: (message: Message) => MaybePromise<void>;
  /// Called on tool use
  onToolUse?: (toolCall: ToolCall, result: ToolResult) => MaybePromise<void>;
  /// Called on error
  onError?: (error: Error, context: AgentContext) => MaybePromise<void>;
  /// Called before streaming chunk
  onStreamChunk?: (chunk: StreamChunk) => MaybePromise<void>;
}

/**
 * Agent context during execution
 */
export interface AgentContext {
  /// Agent ID
  agentId: string;
  /// Conversation ID
  conversationId: string;
  /// Current turn number
  turnNumber: number;
  /// Message history
  messages: Message[];
  /// Available tools
  tools: Map<string, ToolDefinition>;
  /// Sandbox info
  sandbox?: SandboxInfo;
  /// Custom context
  custom?: Record<string, unknown>;
}

/**
 * Agent execution result
 */
export interface AgentResult {
  /// Execution ID
  executionId: string;
  /// Agent ID
  agentId: string;
  /// Final response
  response: string;
  /// Whether the agent completed successfully
  success: boolean;
  /// Error if failed
  error?: AgentError;
  /// Tool calls made
  toolCalls?: ToolCall[];
  /// Tool results
  toolResults?: ToolResult[];
  /// Total tokens used
  totalTokens: number;
  /// Execution duration
  duration: number;
  /// Conversation turns used
  turns: number;
  /// Telemetry data
  telemetry?: TelemetryData;
}

/**
 * Agent error details
 */
export interface AgentError {
  /// Error type
  type: 'llm_error' | 'tool_error' | 'sandbox_error' | 'permission_error' | 'timeout' | 'unknown';
  /// Error message
  message: string;
  /// Stack trace
  stack?: string;
  /// Whether the error is recoverable
  recoverable: boolean;
  /// Recovery suggestions
  recoverySuggestions?: string[];
}

/**
 * Streaming chunk from the agent
 */
export interface StreamChunk {
  /// Chunk ID
  id: string;
  /// Chunk content
  content: string;
  /// Whether this is the final chunk
  isFinal: boolean;
  /// Tool call if present
  toolCall?: Partial<ToolCall>;
  /// Token usage so far
  tokenUsage?: TokenUsage;
  /// Reasoning content (for models that support it)
  reasoning?: string;
}

// ============================================================================
// MCP TYPES
// ============================================================================

/**
 * MCP protocol version
 */
export type MCPVersion = '1.0' | '2.0';

/**
 * MCP transport type
 */
export type MCPTransportType = 'stdio' | 'http' | 'websocket' | 'memory';

/**
 * MCP client configuration
 */
export interface MCPClientConfig {
  /// Client name
  name: string;
  /// Client version
  version: string;
  /// Protocol version
  protocolVersion: MCPVersion;
  /// Transport type
  transport: MCPTransportType;
  /// Transport options
  transportOptions?: MCPTransportOptions;
  /// Connection timeout
  timeout?: number;
  /// Retry configuration
  retry?: MCPRetryConfig;
  /// Custom capabilities
  capabilities?: MCPCapabilities;
}

/**
 * MCP transport options
 */
export interface MCPTransportOptions {
  /// HTTP endpoint URL
  url?: string;
  /// WebSocket endpoint URL
  wsUrl?: string;
  /// Headers for HTTP requests
  headers?: Record<string, string>;
  /// Command for stdio transport
  command?: string;
  /// Arguments for stdio transport
  args?: string[];
  /// Environment variables for stdio
  env?: Record<string, string>;
}

/**
 * MCP retry configuration
 */
export interface MCPRetryConfig {
  /// Maximum retry attempts
  maxAttempts: number;
  /// Initial delay in milliseconds
  initialDelay: number;
  /// Maximum delay in milliseconds
  maxDelay: number;
  /// Backoff multiplier
  backoffMultiplier: number;
  /// Whether to retry on specific errors
  retryOn?: string[];
}

/**
 * MCP capabilities
 */
export interface MCPCapabilities {
  /// Tool capabilities
  tools?: {
    /// Whether tools are supported
    supported: boolean;
    /// Whether tool list changes are supported
    listChanged?: boolean;
  };
  /// Resource capabilities
  resources?: {
    /// Whether resources are supported
    supported: boolean;
    /// Whether resource list changes are supported
    listChanged?: boolean;
    /// Whether resource templates are supported
    templates?: boolean;
  };
  /// Prompt capabilities
  prompts?: {
    /// Whether prompts are supported
    supported: boolean;
    /// Whether prompt list changes are supported
    listChanged?: boolean;
  };
  /// Sampling capabilities
  sampling?: {
    /// Whether sampling is supported
    supported: boolean;
  };
  /// Logging capabilities
  logging?: {
    /// Whether logging is supported
    supported: boolean;
    /// Supported log levels
    levels?: string[];
  };
}

/**
 * MCP server information
 */
export interface MCPServerInfo {
  /// Server name
  name: string;
  /// Server version
  version: string;
  /// Protocol version
  protocolVersion: MCPVersion;
  /// Server capabilities
  capabilities: MCPCapabilities;
  /// Server instructions
  instructions?: string;
}

/**
 * MCP tool definition (extends base Tool)
 */
export interface MCPTool extends ToolDefinition {
  /// Input schema as JSON Schema
  inputSchema: ToolParameterSchema;
  /// Output schema if available
  outputSchema?: ToolParameterSchema;
  /// Whether the tool requires confirmation
  requiresConfirmation?: boolean;
  /// Danger level
  dangerLevel?: 'low' | 'medium' | 'high';
}

/**
 * MCP resource definition
 */
export interface MCPResource {
  /// Resource URI
  uri: string;
  /// Resource name
  name: string;
  /// Resource description
  description?: string;
  /// MIME type
  mimeType?: string;
  /// Resource templates
  templates?: MCPResourceTemplate[];
}

/**
 * MCP resource template
 */
export interface MCPResourceTemplate {
  /// Template pattern
  uriTemplate: string;
  /// Template name
  name: string;
  /// Template description
  description?: string;
  /// MIME type
  mimeType?: string;
}

/**
 * MCP prompt definition
 */
export interface MCPPrompt {
  /// Prompt identifier
  id: string;
  /// Prompt name
  name: string;
  /// Prompt description
  description?: string;
  /// Prompt arguments
  arguments?: MCPPromptArgument[];
  /// Prompt messages
  messages: MCPPromptMessage[];
}

/**
 * MCP prompt argument
 */
export interface MCPPromptArgument {
  /// Argument name
  name: string;
  /// Argument description
  description?: string;
  /// Whether the argument is required
  required: boolean;
}

/**
 * MCP prompt message
 */
export interface MCPPromptMessage {
  /// Message role
  role: MessageRole;
  /// Message content
  content: string;
}

/**
 * MCP message types
 */
export type MCPMessageType =
  | 'initialize'
  | 'initialized'
  | 'ping'
  | 'pong'
  | 'list_tools'
  | 'call_tool'
  | 'list_resources'
  | 'read_resource'
  | 'list_prompts'
  | 'get_prompt'
  | 'logging'
  | 'sampling'
  | 'error';

/**
 * MCP request base
 */
export interface MCPRequest<T = unknown> {
  /// Request ID
  id: string;
  /// Message type
  type: MCPMessageType;
  /// Request payload
  payload: T;
  /// Timestamp
  timestamp: Date;
}

/**
 * MCP response base
 */
export interface MCPResponse<T = unknown> {
  /// Request ID being responded to
  requestId: string;
  /// Message type
  type: MCPMessageType;
  /// Response payload
  payload: T;
  /// Whether the request succeeded
  success: boolean;
  /// Error if failed
  error?: MCPError;
  /// Timestamp
  timestamp: Date;
}

/**
 * MCP error details
 */
export interface MCPError {
  /// Error code
  code: number;
  /// Error message
  message: string;
  /// Error data
  data?: unknown;
}

// ============================================================================
// SAFETY TYPES
// ============================================================================

/**
 * Safety check result
 */
export interface SafetyCheckResult {
  /// Whether the check passed
  passed: boolean;
  /// Check type
  type: SafetyCheckType;
  /// Risk level if detected
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  /// Detected issues
  issues?: SafetyIssue[];
  /// Sanitized content if applicable
  sanitizedContent?: string;
  /// Check metadata
  metadata?: Record<string, unknown>;
}

/**
 * Types of safety checks
 */
export type SafetyCheckType =
  | 'injection'
  | 'pii'
  | 'profanity'
  | 'harmful_content'
  | 'jailbreak'
  | 'custom';

/**
 * Safety issue detected
 */
export interface SafetyIssue {
  /// Issue type
  type: string;
  /// Issue severity
  severity: 'info' | 'warning' | 'error' | 'critical';
  /// Issue description
  description: string;
  /// Location in content
  location?: {
    start: number;
    end: number;
  };
  /// Matched pattern or text
  match?: string;
  /// Suggested fix
  suggestion?: string;
}

/**
 * Content filter configuration
 */
export interface ContentFilterConfig {
  /// Filter name
  name: string;
  /// Whether the filter is enabled
  enabled: boolean;
  /// Filter priority (higher runs first)
  priority: number;
  /// Filter patterns
  patterns?: string[];
  /// Custom filter function
  filter?: (content: string) => MaybePromise<SafetyCheckResult>;
  /// Action to take on match
  action: 'block' | 'sanitize' | 'warn' | 'log';
  /// Custom configuration
  config?: Record<string, unknown>;
}

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Client configuration
 */
export interface ClientConfig {
  /// API endpoint URL
  endpoint?: string;
  /// API key for authentication
  apiKey?: string;
  /// Connection timeout in milliseconds
  timeout?: number;
  /// WebSocket configuration
  websocket?: WebSocketConfig;
  /// Retry configuration
  retry?: RetryConfig;
  /// Telemetry configuration
  telemetry?: ClientTelemetryConfig;
  /// Log level
  logLevel?: LogLevel;
  /// Custom headers
  headers?: Record<string, string>;
  /// Custom configuration
  custom?: Record<string, unknown>;
}

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  /// Whether WebSocket is enabled
  enabled: boolean;
  /// WebSocket endpoint URL
  url?: string;
  /// Reconnection enabled
  reconnect?: boolean;
  /// Maximum reconnection attempts
  maxReconnectAttempts?: number;
  /// Reconnection delay in milliseconds
  reconnectDelay?: number;
  /// Heartbeat interval in milliseconds
  heartbeatInterval?: number;
  /// Whether to use compression
  compression?: boolean;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /// Maximum retry attempts
  maxAttempts: number;
  /// Initial delay in milliseconds
  initialDelay: number;
  /// Maximum delay in milliseconds
  maxDelay: number;
  /// Backoff multiplier
  backoffMultiplier: number;
  /// Whether to retry on all errors
  retryAll?: boolean;
  /// Specific error codes to retry
  retryOnErrors?: number[];
  /// Whether to use jitter
  jitter?: boolean;
}

/**
 * Client telemetry configuration
 */
export interface ClientTelemetryConfig {
  /// Whether telemetry is enabled
  enabled: boolean;
  /// Sampling rate (0-1)
  samplingRate?: number;
  /// Export endpoint
  exportEndpoint?: string;
  /// Export interval in milliseconds
  exportInterval?: number;
  /// Headers for export requests
  exportHeaders?: Record<string, string>;
}

/**
 * Log level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Connection state
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * Connection info
 */
export interface ConnectionInfo {
  /// Current state
  state: ConnectionState;
  /// Connected endpoint
  endpoint?: string;
  /// Connection timestamp
  connectedAt?: Date;
  /// Last activity timestamp
  lastActivity?: Date;
  /// Number of reconnections
  reconnectCount?: number;
  /// Connection latency in milliseconds
  latency?: number;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Event types emitted by various components
 */
export type WRAPEventType =
  | 'sandbox:created'
  | 'sandbox:destroyed'
  | 'sandbox:state_change'
  | 'sandbox:resource_usage'
  | 'sandbox:boundary_violation'
  | 'sandbox:error'
  | 'agent:started'
  | 'agent:completed'
  | 'agent:message'
  | 'agent:tool_use'
  | 'agent:tool_result'
  | 'agent:error'
  | 'agent:streaming'
  | 'tool:registered'
  | 'tool:executed'
  | 'tool:error'
  | 'permission:granted'
  | 'permission:revoked'
  | 'permission:denied'
  | 'safety:violation'
  | 'safety:warning'
  | 'connection:state_change'
  | 'connection:error'
  | 'mcp:discovered'
  | 'mcp:tool_call'
  | 'telemetry:span_start'
  | 'telemetry:span_end'
  | 'telemetry:metric';

/**
 * Base event interface
 */
export interface WRAPEvent<T = unknown> {
  /// Event type
  type: WRAPEventType;
  /// Event ID
  id: string;
  /// Event timestamp
  timestamp: Date;
  /// Event payload
  payload: T;
  /// Event source
  source?: string;
  /// Event correlation ID
  correlationId?: string;
  /// Event metadata
  metadata?: Record<string, unknown>;
}

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (event: WRAPEvent<T>) => void;

// ============================================================================
// EXPORT ALL TYPES
// ============================================================================

export default {
  // Re-export utility types
  RequiredKeys,
  OptionalKeys,
  DeepPartial,
  DeepRequired,
  DeepReadonly,
  ArrayElement,
  Mutable,
  MaybePromise,
  Nullable,
  NonEmptyArray,
  ObjectKeys,
  ObjectEntries,
  Branded,
  Parameters,
  ReturnType,
  AwaitedReturnType,
};

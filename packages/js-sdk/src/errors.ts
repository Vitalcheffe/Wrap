/**
 * @fileoverview Error classes hierarchy for WRAP Nebula JavaScript SDK
 * @module @wrap-nebula/js-sdk/errors
 * @description This module contains all error classes used throughout the WRAP Nebula SDK.
 * Errors are organized in a hierarchy with base classes and specialized error types
 * for different scenarios. Each error includes error codes, recovery suggestions,
 * and contextual information for debugging and handling.
 */

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Error code definitions for all SDK errors
 * @description Error codes are organized by category:
 * - 1xxx: General/Client errors
 * - 2xxx: Sandbox errors
 * - 3xxx: Agent errors
 * - 4xxx: Tool errors
 * - 5xxx: Permission errors
 * - 6xxx: Safety errors
 * - 7xxx: MCP errors
 * - 8xxx: Network/Connection errors
 * - 9xxx: Telemetry errors
 */
export const ErrorCodes = {
  // General errors (1xxx)
  UNKNOWN: 1000,
  INVALID_ARGUMENT: 1001,
  INVALID_CONFIGURATION: 1002,
  NOT_INITIALIZED: 1003,
  ALREADY_INITIALIZED: 1004,
  OPERATION_CANCELLED: 1005,
  OPERATION_TIMEOUT: 1006,
  FEATURE_NOT_SUPPORTED: 1007,
  VALIDATION_ERROR: 1008,
  SERIALIZATION_ERROR: 1009,
  DESERIALIZATION_ERROR: 1010,
  STATE_ERROR: 1011,
  NOT_FOUND: 1012,
  ALREADY_EXISTS: 1013,
  RATE_LIMIT_EXCEEDED: 1014,
  QUOTA_EXCEEDED: 1015,
  
  // Sandbox errors (2xxx)
  SANDBOX_CREATION_FAILED: 2000,
  SANDBOX_DESTROY_FAILED: 2001,
  SANDBOX_EXECUTION_FAILED: 2002,
  SANDBOX_TIMEOUT: 2003,
  SANDBOX_MEMORY_EXCEEDED: 2004,
  SANDBOX_CPU_EXCEEDED: 2005,
  SANDBOX_NETWORK_BLOCKED: 2006,
  SANDBOX_FILE_ACCESS_DENIED: 2007,
  SANDBOX_PROCESS_DENIED: 2008,
  SANDBOX_BOUNDARY_VIOLATION: 2009,
  SANDBOX_ISOLATION_FAILED: 2010,
  SANDBOX_V8_ERROR: 2011,
  SANDBOX_CONTAINER_ERROR: 2012,
  SANDBOX_WORKER_ERROR: 2013,
  SANDBOX_STATE_ERROR: 2014,
  SANDBOX_RESOURCE_EXHAUSTED: 2015,
  
  // Agent errors (3xxx)
  AGENT_CREATION_FAILED: 3000,
  AGENT_EXECUTION_FAILED: 3001,
  AGENT_TIMEOUT: 3002,
  AGENT_MAX_TURNS_EXCEEDED: 3003,
  AGENT_CONTEXT_OVERFLOW: 3004,
  AGENT_NO_RESPONSE: 3005,
  AGENT_TOOL_CALL_FAILED: 3006,
  AGENT_STREAMING_ERROR: 3007,
  AGENT_PROVIDER_ERROR: 3008,
  AGENT_MODEL_NOT_FOUND: 3009,
  AGENT_INVALID_RESPONSE: 3010,
  AGENT_CONVERSATION_ERROR: 3011,
  AGENT_MEMORY_ERROR: 3012,
  
  // Tool errors (4xxx)
  TOOL_NOT_FOUND: 4000,
  TOOL_EXECUTION_FAILED: 4001,
  TOOL_TIMEOUT: 4002,
  TOOL_VALIDATION_FAILED: 4003,
  TOOL_PERMISSION_DENIED: 4004,
  TOOL_INPUT_ERROR: 4005,
  TOOL_OUTPUT_ERROR: 4006,
  TOOL_REGISTRATION_FAILED: 4007,
  TOOL_DEREGISTRATION_FAILED: 4008,
  TOOL_DEPENDENCY_ERROR: 4009,
  TOOL_STREAMING_ERROR: 4010,
  
  // Permission errors (5xxx)
  PERMISSION_DENIED: 5000,
  PERMISSION_NOT_GRANTED: 5001,
  PERMISSION_EXPIRED: 5002,
  PERMISSION_CHECK_FAILED: 5003,
  PERMISSION_GRANT_FAILED: 5004,
  PERMISSION_REVOKE_FAILED: 5005,
  PERMISSION_INVALID_SCOPE: 5006,
  PERMISSION_CONDITION_FAILED: 5007,
  
  // Safety errors (6xxx)
  SAFETY_VIOLATION: 6000,
  SAFETY_INJECTION_DETECTED: 6001,
  SAFETY_PII_DETECTED: 6002,
  SAFETY_PROFANITY_DETECTED: 6003,
  SAFETY_HARMFUL_CONTENT: 6004,
  SAFETY_JAILBREAK_DETECTED: 6005,
  SAFETY_CUSTOM_VIOLATION: 6006,
  SAFETY_FILTER_FAILED: 6007,
  
  // MCP errors (7xxx)
  MCP_CONNECTION_FAILED: 7000,
  MCP_HANDSHAKE_FAILED: 7001,
  MCP_PROTOCOL_ERROR: 7002,
  MCP_TOOL_DISCOVERY_FAILED: 7003,
  MCP_RESOURCE_NOT_FOUND: 7004,
  MCP_PROMPT_NOT_FOUND: 7005,
  MCP_TRANSPORT_ERROR: 7006,
  MCP_TIMEOUT: 7007,
  MCP_VERSION_MISMATCH: 7008,
  
  // Network/Connection errors (8xxx)
  CONNECTION_FAILED: 8000,
  CONNECTION_TIMEOUT: 8001,
  CONNECTION_LOST: 8002,
  CONNECTION_REFUSED: 8003,
  WEBSOCKET_ERROR: 8004,
  HTTP_ERROR: 8005,
  DNS_ERROR: 8006,
  TLS_ERROR: 8007,
  
  // Telemetry errors (9xxx)
  TELEMETRY_EXPORT_FAILED: 9000,
  TELEMETRY_SPAN_ERROR: 9001,
  TELEMETRY_METRIC_ERROR: 9002,
  TELEMETRY_CONTEXT_ERROR: 9003,
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============================================================================
// ERROR BASE CLASS
// ============================================================================

/**
 * Base error class for all WRAP SDK errors
 * @description All errors in the WRAP SDK extend from this base class.
 * It provides common functionality for error handling including error codes,
 * recovery suggestions, and contextual information.
 * 
 * @example
 * ```typescript
 * try {
 *   await sandbox.execute(code);
 * } catch (error) {
 *   if (error instanceof WRAPError) {
 *     console.error(`Error ${error.code}: ${error.message}`);
 *     console.log(`Recovery: ${error.recovery}`);
 *   }
 * }
 * ```
 */
export class WRAPError extends Error {
  /** Unique error code for programmatic handling */
  public readonly code: ErrorCode;
  /** Error category for grouping related errors */
  public readonly category: string;
  /** Timestamp when the error occurred */
  public readonly timestamp: Date;
  /** Whether the error is recoverable */
  public readonly recoverable: boolean;
  /** Suggested recovery action */
  public readonly recovery?: string;
  /** Additional error details */
  public readonly details?: Record<string, unknown>;
  /** Original error if this wraps another error */
  public readonly cause?: Error;
  /** Stack trace capture */
  public readonly stackTrace?: string;

  /**
   * Creates a new WRAPError instance
   * @param message - Error message
   * @param options - Error options
   */
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      category?: string;
      recoverable?: boolean;
      recovery?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'WRAPError';
    this.code = options.code ?? ErrorCodes.UNKNOWN;
    this.category = options.category ?? 'general';
    this.timestamp = new Date();
    this.recoverable = options.recoverable ?? false;
    this.recovery = options.recovery;
    this.details = options.details;
    this.cause = options.cause;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    this.stackTrace = this.stack;
    
    // Set prototype for instanceof checks
    Object.setPrototypeOf(this, WRAPError.prototype);
  }

  /**
   * Converts the error to a JSON-serializable object
   * @returns JSON representation of the error
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      timestamp: this.timestamp.toISOString(),
      recoverable: this.recoverable,
      recovery: this.recovery,
      details: this.details,
      stack: this.stackTrace,
      cause: this.cause?.message,
    };
  }

  /**
   * Creates a string representation of the error
   * @returns Formatted error string
   */
  public override toString(): string {
    const parts = [
      `${this.name} [${this.code}]`,
      this.message,
    ];
    
    if (this.recovery) {
      parts.push(`Recovery: ${this.recovery}`);
    }
    
    if (this.details && Object.keys(this.details).length > 0) {
      parts.push(`Details: ${JSON.stringify(this.details)}`);
    }
    
    return parts.join(' - ');
  }

  /**
   * Checks if this error matches a specific error code
   * @param code - Error code to check
   * @returns True if the error code matches
   */
  public hasCode(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * Checks if the error is related to a specific category
   * @param category - Category to check
   * @returns True if the category matches
   */
  public isCategory(category: string): boolean {
    return this.category === category;
  }

  /**
   * Gets a user-friendly error message
   * @returns User-friendly error description
   */
  public getUserMessage(): string {
    const recoveryText = this.recovery 
      ? ` You can try: ${this.recovery}.`
      : '';
    
    return `An error occurred: ${this.message}.${recoveryText}`;
  }
}

// ============================================================================
// GENERAL ERRORS
// ============================================================================

/**
 * Error thrown when an invalid argument is provided
 * @description Use this error when function arguments don't meet the expected
 * format, type, or constraints. Include details about what was expected.
 */
export class ArgumentError extends WRAPError {
  /** Name of the invalid argument */
  public readonly argumentName?: string;
  /** Expected type or format */
  public readonly expected?: string;
  /** Actual value received */
  public readonly actual?: unknown;

  constructor(
    message: string,
    options: {
      argumentName?: string;
      expected?: string;
      actual?: unknown;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      category: 'validation',
      recoverable: true,
      recovery: 'Check the argument format and try again',
      details: {
        ...options.details,
        argumentName: options.argumentName,
        expected: options.expected,
        actual: typeof options.actual === 'object' 
          ? JSON.stringify(options.actual) 
          : options.actual,
      },
    });
    this.name = 'ArgumentError';
    this.argumentName = options.argumentName;
    this.expected = options.expected;
    this.actual = options.actual;
    Object.setPrototypeOf(this, ArgumentError.prototype);
  }
}

/**
 * Error thrown when configuration is invalid
 * @description Use this error when configuration options are missing,
 * conflicting, or malformed.
 */
export class ConfigurationError extends WRAPError {
  /** Configuration key that's invalid */
  public readonly configKey?: string;
  /** Configuration path */
  public readonly configPath?: string;

  constructor(
    message: string,
    options: {
      configKey?: string;
      configPath?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.INVALID_CONFIGURATION,
      category: 'configuration',
      recoverable: true,
      recovery: 'Review the configuration settings and correct any issues',
      details: {
        ...options.details,
        configKey: options.configKey,
        configPath: options.configPath,
      },
    });
    this.name = 'ConfigurationError';
    this.configKey = options.configKey;
    this.configPath = options.configPath;
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error thrown when an operation times out
 * @description Use this error when an operation exceeds its allowed time limit.
 */
export class TimeoutError extends WRAPError {
  /** Timeout duration in milliseconds */
  public readonly timeoutMs: number;
  /** Operation that timed out */
  public readonly operation?: string;

  constructor(
    message: string,
    options: {
      timeoutMs: number;
      operation?: string;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, {
      code: ErrorCodes.OPERATION_TIMEOUT,
      category: 'timeout',
      recoverable: true,
      recovery: 'Increase the timeout duration or optimize the operation',
      details: {
        ...options.details,
        timeoutMs: options.timeoutMs,
        operation: options.operation,
      },
    });
    this.name = 'TimeoutError';
    this.timeoutMs = options.timeoutMs;
    this.operation = options.operation;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Error thrown when an operation is cancelled
 * @description Use this error when an operation is cancelled before completion.
 */
export class CancellationError extends WRAPError {
  /** Reason for cancellation */
  public readonly reason?: string;

  constructor(
    message: string,
    options: {
      reason?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.OPERATION_CANCELLED,
      category: 'cancellation',
      recoverable: true,
      recovery: 'Retry the operation if needed',
      details: {
        ...options.details,
        reason: options.reason,
      },
    });
    this.name = 'CancellationError';
    this.reason = options.reason;
    Object.setPrototypeOf(this, CancellationError.prototype);
  }
}

/**
 * Error thrown when validation fails
 * @description Use this error for input validation failures.
 */
export class ValidationError extends WRAPError {
  /** Validation errors by field */
  public readonly errors: Map<string, string[]>;

  constructor(
    message: string,
    errors: Map<string, string[]> | Record<string, string[]>,
    options: {
      details?: Record<string, unknown>;
    } = {}
  ) {
    const errorMap = errors instanceof Map 
      ? errors 
      : new Map(Object.entries(errors));
    
    super(message, {
      code: ErrorCodes.VALIDATION_ERROR,
      category: 'validation',
      recoverable: true,
      recovery: 'Correct the validation errors and try again',
      details: {
        ...options.details,
        errors: Object.fromEntries(errorMap),
      },
    });
    this.name = 'ValidationError';
    this.errors = errorMap;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  /**
   * Gets errors for a specific field
   * @param field - Field name
   * @returns Array of error messages for the field
   */
  public getErrors(field: string): string[] {
    return this.errors.get(field) ?? [];
  }

  /**
   * Checks if a specific field has errors
   * @param field - Field name
   * @returns True if the field has errors
   */
  public hasErrors(field: string): boolean {
    const fieldErrors = this.errors.get(field);
    return fieldErrors !== undefined && fieldErrors.length > 0;
  }
}

/**
 * Error thrown when something is not found
 * @description Use this error when a requested resource doesn't exist.
 */
export class NotFoundError extends WRAPError {
  /** Type of resource not found */
  public readonly resourceType?: string;
  /** Resource identifier */
  public readonly resourceId?: string;

  constructor(
    message: string,
    options: {
      resourceType?: string;
      resourceId?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.NOT_FOUND,
      category: 'not_found',
      recoverable: false,
      recovery: 'Verify the resource identifier and ensure the resource exists',
      details: {
        ...options.details,
        resourceType: options.resourceType,
        resourceId: options.resourceId,
      },
    });
    this.name = 'NotFoundError';
    this.resourceType = options.resourceType;
    this.resourceId = options.resourceId;
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when something already exists
 * @description Use this error when trying to create a resource that already exists.
 */
export class AlreadyExistsError extends WRAPError {
  /** Type of resource */
  public readonly resourceType?: string;
  /** Resource identifier */
  public readonly resourceId?: string;

  constructor(
    message: string,
    options: {
      resourceType?: string;
      resourceId?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.ALREADY_EXISTS,
      category: 'conflict',
      recoverable: true,
      recovery: 'Use a different identifier or update the existing resource',
      details: {
        ...options.details,
        resourceType: options.resourceType,
        resourceId: options.resourceId,
      },
    });
    this.name = 'AlreadyExistsError';
    this.resourceType = options.resourceType;
    this.resourceId = options.resourceId;
    Object.setPrototypeOf(this, AlreadyExistsError.prototype);
  }
}

// ============================================================================
// SANDBOX ERRORS
// ============================================================================

/**
 * Base error for sandbox-related errors
 * @description All sandbox errors extend from this class.
 */
export class SandboxError extends WRAPError {
  /** Sandbox ID where the error occurred */
  public readonly sandboxId?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      sandboxId?: string;
      recoverable?: boolean;
      recovery?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.SANDBOX_EXECUTION_FAILED,
      category: 'sandbox',
      recoverable: options.recoverable ?? false,
      recovery: options.recovery,
      details: {
        ...options.details,
        sandboxId: options.sandboxId,
      },
      cause: options.cause,
    });
    this.name = 'SandboxError';
    this.sandboxId = options.sandboxId;
    Object.setPrototypeOf(this, SandboxError.prototype);
  }
}

/**
 * Error thrown when sandbox creation fails
 */
export class SandboxCreationError extends SandboxError {
  constructor(
    message: string,
    options: {
      sandboxId?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.SANDBOX_CREATION_FAILED,
      sandboxId: options.sandboxId,
      recoverable: true,
      recovery: 'Check sandbox configuration and try again',
      details: options.details,
      cause: options.cause,
    });
    this.name = 'SandboxCreationError';
    Object.setPrototypeOf(this, SandboxCreationError.prototype);
  }
}

/**
 * Error thrown when sandbox execution fails
 */
export class SandboxExecutionError extends SandboxError {
  /** Code that failed to execute */
  public readonly code?: string;
  /** Line number where the error occurred */
  public readonly lineNumber?: number;
  /** Column number where the error occurred */
  public readonly columnNumber?: number;

  constructor(
    message: string,
    options: {
      sandboxId?: string;
      code?: string;
      lineNumber?: number;
      columnNumber?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.SANDBOX_EXECUTION_FAILED,
      sandboxId: options.sandboxId,
      recoverable: false,
      recovery: 'Fix the code error and try again',
      details: {
        ...options.details,
        code: options.code,
        lineNumber: options.lineNumber,
        columnNumber: options.columnNumber,
      },
      cause: options.cause,
    });
    this.name = 'SandboxExecutionError';
    this.code = options.code;
    this.lineNumber = options.lineNumber;
    this.columnNumber = options.columnNumber;
    Object.setPrototypeOf(this, SandboxExecutionError.prototype);
  }
}

/**
 * Error thrown when sandbox memory limit is exceeded
 */
export class SandboxMemoryError extends SandboxError {
  /** Memory limit in bytes */
  public readonly memoryLimit: number;
  /** Memory used in bytes */
  public readonly memoryUsed: number;

  constructor(
    message: string,
    options: {
      sandboxId?: string;
      memoryLimit: number;
      memoryUsed: number;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, {
      code: ErrorCodes.SANDBOX_MEMORY_EXCEEDED,
      sandboxId: options.sandboxId,
      recoverable: true,
      recovery: 'Increase memory limit or optimize code memory usage',
      details: {
        ...options.details,
        memoryLimit,
        memoryUsed: options.memoryUsed,
      },
    });
    this.name = 'SandboxMemoryError';
    this.memoryLimit = options.memoryLimit;
    this.memoryUsed = options.memoryUsed;
    Object.setPrototypeOf(this, SandboxMemoryError.prototype);
  }
}

/**
 * Error thrown when sandbox boundary is violated
 */
export class SandboxBoundaryError extends SandboxError {
  /** Type of boundary that was violated */
  public readonly boundaryType: string;
  /** Current value that violated the boundary */
  public readonly currentValue: unknown;
  /** Boundary limit that was exceeded */
  public readonly limit: unknown;

  constructor(
    message: string,
    options: {
      sandboxId?: string;
      boundaryType: string;
      currentValue: unknown;
      limit: unknown;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, {
      code: ErrorCodes.SANDBOX_BOUNDARY_VIOLATION,
      sandboxId: options.sandboxId,
      recoverable: false,
      recovery: 'Stay within the defined boundaries or request expanded limits',
      details: {
        ...options.details,
        boundaryType: options.boundaryType,
        currentValue: options.currentValue,
        limit: options.limit,
      },
    });
    this.name = 'SandboxBoundaryError';
    this.boundaryType = options.boundaryType;
    this.currentValue = options.currentValue;
    this.limit = options.limit;
    Object.setPrototypeOf(this, SandboxBoundaryError.prototype);
  }
}

/**
 * Error thrown when V8 isolate operations fail
 */
export class V8IsolateError extends SandboxError {
  constructor(
    message: string,
    options: {
      sandboxId?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.SANDBOX_V8_ERROR,
      sandboxId: options.sandboxId,
      recoverable: false,
      recovery: 'Check V8 isolate configuration and try again',
      details: options.details,
      cause: options.cause,
    });
    this.name = 'V8IsolateError';
    Object.setPrototypeOf(this, V8IsolateError.prototype);
  }
}

/**
 * Error thrown when container operations fail
 */
export class ContainerError extends SandboxError {
  /** Container ID */
  public readonly containerId?: string;
  /** Container image */
  public readonly image?: string;

  constructor(
    message: string,
    options: {
      sandboxId?: string;
      containerId?: string;
      image?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.SANDBOX_CONTAINER_ERROR,
      sandboxId: options.sandboxId,
      recoverable: true,
      recovery: 'Check container configuration and try again',
      details: {
        ...options.details,
        containerId: options.containerId,
        image: options.image,
      },
      cause: options.cause,
    });
    this.name = 'ContainerError';
    this.containerId = options.containerId;
    this.image = options.image;
    Object.setPrototypeOf(this, ContainerError.prototype);
  }
}

// ============================================================================
// AGENT ERRORS
// ============================================================================

/**
 * Base error for agent-related errors
 * @description All agent errors extend from this class.
 */
export class AgentError extends WRAPError {
  /** Agent ID where the error occurred */
  public readonly agentId?: string;
  /** Conversation ID */
  public readonly conversationId?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      agentId?: string;
      conversationId?: string;
      recoverable?: boolean;
      recovery?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.AGENT_EXECUTION_FAILED,
      category: 'agent',
      recoverable: options.recoverable ?? false,
      recovery: options.recovery,
      details: {
        ...options.details,
        agentId: options.agentId,
        conversationId: options.conversationId,
      },
      cause: options.cause,
    });
    this.name = 'AgentError';
    this.agentId = options.agentId;
    this.conversationId = options.conversationId;
    Object.setPrototypeOf(this, AgentError.prototype);
  }
}

/**
 * Error thrown when agent execution fails
 */
export class AgentExecutionError extends AgentError {
  /** Turn number where the error occurred */
  public readonly turnNumber?: number;

  constructor(
    message: string,
    options: {
      agentId?: string;
      conversationId?: string;
      turnNumber?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.AGENT_EXECUTION_FAILED,
      agentId: options.agentId,
      conversationId: options.conversationId,
      recoverable: true,
      recovery: 'Retry the operation or adjust the agent configuration',
      details: {
        ...options.details,
        turnNumber: options.turnNumber,
      },
      cause: options.cause,
    });
    this.name = 'AgentExecutionError';
    this.turnNumber = options.turnNumber;
    Object.setPrototypeOf(this, AgentExecutionError.prototype);
  }
}

/**
 * Error thrown when agent reaches maximum turns
 */
export class AgentMaxTurnsError extends AgentError {
  /** Maximum turns allowed */
  public readonly maxTurns: number;
  /** Current turn count */
  public readonly currentTurns: number;

  constructor(
    message: string,
    options: {
      agentId?: string;
      conversationId?: string;
      maxTurns: number;
      currentTurns: number;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, {
      code: ErrorCodes.AGENT_MAX_TURNS_EXCEEDED,
      agentId: options.agentId,
      conversationId: options.conversationId,
      recoverable: true,
      recovery: 'Increase max turns or simplify the task',
      details: {
        ...options.details,
        maxTurns: options.maxTurns,
        currentTurns: options.currentTurns,
      },
    });
    this.name = 'AgentMaxTurnsError';
    this.maxTurns = options.maxTurns;
    this.currentTurns = options.currentTurns;
    Object.setPrototypeOf(this, AgentMaxTurnsError.prototype);
  }
}

/**
 * Error thrown when LLM provider fails
 */
export class LLMProviderError extends AgentError {
  /** Provider name */
  public readonly provider: string;
  /** Model name */
  public readonly model?: string;
  /** HTTP status code if applicable */
  public readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      agentId?: string;
      provider: string;
      model?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      code: ErrorCodes.AGENT_PROVIDER_ERROR,
      agentId: options.agentId,
      recoverable: options.statusCode ? options.statusCode >= 500 : true,
      recovery: 'Check API credentials and rate limits, then retry',
      details: {
        ...options.details,
        provider: options.provider,
        model: options.model,
        statusCode: options.statusCode,
      },
      cause: options.cause,
    });
    this.name = 'LLMProviderError';
    this.provider = options.provider;
    this.model = options.model;
    this.statusCode = options.statusCode;
    Object.setPrototypeOf(this, LLMProviderError.prototype);
  }
}

// ============================================================================
// TOOL ERRORS
// ============================================================================

/**
 * Base error for tool-related errors
 * @description All tool errors extend from this class.
 */
export class ToolError extends WRAPError {
  /** Tool name */
  public readonly toolName: string;
  /** Execution ID */
  public readonly executionId?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      toolName: string;
      executionId?: string;
      recoverable?: boolean;
      recovery?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.TOOL_EXECUTION_FAILED,
      category: 'tool',
      recoverable: options.recoverable ?? false,
      recovery: options.recovery,
      details: {
        ...options.details,
        toolName: options.toolName,
        executionId: options.executionId,
      },
      cause: options.cause,
    });
    this.name = 'ToolError';
    this.toolName = options.toolName;
    this.executionId = options.executionId;
    Object.setPrototypeOf(this, ToolError.prototype);
  }
}

/**
 * Error thrown when a tool is not found
 */
export class ToolNotFoundError extends ToolError {
  constructor(
    toolName: string,
    options: {
      executionId?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(`Tool not found: ${toolName}`, {
      code: ErrorCodes.TOOL_NOT_FOUND,
      toolName,
      executionId: options.executionId,
      recoverable: false,
      recovery: 'Check the tool name and ensure it is registered',
      details: options.details,
    });
    this.name = 'ToolNotFoundError';
    Object.setPrototypeOf(this, ToolNotFoundError.prototype);
  }
}

/**
 * Error thrown when tool execution fails
 */
export class ToolExecutionError extends ToolError {
  /** Tool call ID */
  public readonly toolCallId?: string;
  /** Input that caused the error */
  public readonly input?: unknown;

  constructor(
    message: string,
    options: {
      toolName: string;
      executionId?: string;
      toolCallId?: string;
      input?: unknown;
      details?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      code: ErrorCodes.TOOL_EXECUTION_FAILED,
      toolName: options.toolName,
      executionId: options.executionId,
      recoverable: true,
      recovery: 'Check tool input and try again',
      details: {
        ...options.details,
        toolCallId: options.toolCallId,
        input: options.input,
      },
      cause: options.cause,
    });
    this.name = 'ToolExecutionError';
    this.toolCallId = options.toolCallId;
    this.input = options.input;
    Object.setPrototypeOf(this, ToolExecutionError.prototype);
  }
}

/**
 * Error thrown when tool input validation fails
 */
export class ToolValidationError extends ToolError {
  /** Validation errors */
  public readonly validationErrors: Record<string, string[]>;

  constructor(
    toolName: string,
    validationErrors: Record<string, string[]>,
    options: {
      executionId?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(`Tool validation failed: ${toolName}`, {
      code: ErrorCodes.TOOL_VALIDATION_FAILED,
      toolName,
      executionId: options.executionId,
      recoverable: true,
      recovery: 'Correct the input validation errors and try again',
      details: {
        ...options.details,
        validationErrors,
      },
    });
    this.name = 'ToolValidationError';
    this.validationErrors = validationErrors;
    Object.setPrototypeOf(this, ToolValidationError.prototype);
  }
}

// ============================================================================
// PERMISSION ERRORS
// ============================================================================

/**
 * Error thrown when permission is denied
 */
export class PermissionError extends WRAPError {
  /** Permission that was denied */
  public readonly permission: string;
  /** Resource that was accessed */
  public readonly resource?: string;
  /** Action that was attempted */
  public readonly action?: string;

  constructor(
    message: string,
    options: {
      permission: string;
      resource?: string;
      action?: string;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, {
      code: ErrorCodes.PERMISSION_DENIED,
      category: 'permission',
      recoverable: false,
      recovery: 'Request the required permission from an administrator',
      details: {
        ...options.details,
        permission: options.permission,
        resource: options.resource,
        action: options.action,
      },
    });
    this.name = 'PermissionError';
    this.permission = options.permission;
    this.resource = options.resource;
    this.action = options.action;
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

/**
 * Error thrown when a permission check fails
 */
export class PermissionCheckError extends WRAPError {
  constructor(
    message: string,
    options: {
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.PERMISSION_CHECK_FAILED,
      category: 'permission',
      recoverable: true,
      recovery: 'Retry the permission check',
      details: options.details,
      cause: options.cause,
    });
    this.name = 'PermissionCheckError';
    Object.setPrototypeOf(this, PermissionCheckError.prototype);
  }
}

// ============================================================================
// SAFETY ERRORS
// ============================================================================

/**
 * Error thrown when a safety violation is detected
 */
export class SafetyError extends WRAPError {
  /** Type of safety violation */
  public readonly violationType: string;
  /** Severity of the violation */
  public readonly severity: 'low' | 'medium' | 'high' | 'critical';
  /** Content that triggered the violation */
  public readonly content?: string;

  constructor(
    message: string,
    options: {
      violationType: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      content?: string;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, {
      code: ErrorCodes.SAFETY_VIOLATION,
      category: 'safety',
      recoverable: false,
      recovery: 'Modify the content to comply with safety guidelines',
      details: {
        ...options.details,
        violationType: options.violationType,
        severity: options.severity,
      },
    });
    this.name = 'SafetyError';
    this.violationType = options.violationType;
    this.severity = options.severity;
    this.content = options.content;
    Object.setPrototypeOf(this, SafetyError.prototype);
  }
}

/**
 * Error thrown when injection attack is detected
 */
export class InjectionError extends SafetyError {
  constructor(
    message: string,
    options: {
      content?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message, {
      violationType: 'injection',
      severity: 'high',
      content: options.content,
      details: options.details,
    });
    this.name = 'InjectionError';
    Object.setPrototypeOf(this, InjectionError.prototype);
  }
}

// ============================================================================
// CONNECTION ERRORS
// ============================================================================

/**
 * Error thrown when connection fails
 */
export class ConnectionError extends WRAPError {
  /** Endpoint that failed */
  public readonly endpoint?: string;
  /** HTTP status code */
  public readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      endpoint?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: ErrorCodes.CONNECTION_FAILED,
      category: 'connection',
      recoverable: true,
      recovery: 'Check network connectivity and endpoint availability',
      details: {
        ...options.details,
        endpoint: options.endpoint,
        statusCode: options.statusCode,
      },
      cause: options.cause,
    });
    this.name = 'ConnectionError';
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Error thrown when WebSocket operations fail
 */
export class WebSocketError extends ConnectionError {
  /** WebSocket ready state */
  public readonly readyState?: number;
  /** Close code if connection was closed */
  public readonly closeCode?: number;
  /** Close reason */
  public readonly closeReason?: string;

  constructor(
    message: string,
    options: {
      endpoint?: string;
      readyState?: number;
      closeCode?: number;
      closeReason?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      endpoint: options.endpoint,
      details: {
        ...options.details,
        readyState: options.readyState,
        closeCode: options.closeCode,
        closeReason: options.closeReason,
      },
      cause: options.cause,
    });
    this.code = ErrorCodes.WEBSOCKET_ERROR;
    this.name = 'WebSocketError';
    this.readyState = options.readyState;
    this.closeCode = options.closeCode;
    this.closeReason = options.closeReason;
    Object.setPrototypeOf(this, WebSocketError.prototype);
  }
}

// ============================================================================
// MCP ERRORS
// ============================================================================

/**
 * Error thrown when MCP operations fail
 */
export class MCPError extends WRAPError {
  /** MCP error code */
  public readonly mcpCode?: number;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      mcpCode?: number;
      recoverable?: boolean;
      recovery?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.MCP_PROTOCOL_ERROR,
      category: 'mcp',
      recoverable: options.recoverable ?? true,
      recovery: options.recovery,
      details: {
        ...options.details,
        mcpCode: options.mcpCode,
      },
      cause: options.cause,
    });
    this.name = 'MCPError';
    this.mcpCode = options.mcpCode;
    Object.setPrototypeOf(this, MCPError.prototype);
  }
}

// ============================================================================
// ERROR UTILITIES
// ============================================================================

/**
 * Checks if an error is a WRAP error
 * @param error - Error to check
 * @returns True if the error is a WRAP error
 */
export function isWRAPError(error: unknown): error is WRAPError {
  return error instanceof WRAPError;
}

/**
 * Checks if an error is retryable
 * @param error - Error to check
 * @returns True if the error is retryable
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof WRAPError) {
    return error.recoverable;
  }
  return false;
}

/**
 * Gets error code from any error
 * @param error - Error to get code from
 * @returns Error code or UNKNOWN
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (error instanceof WRAPError) {
    return error.code;
  }
  return ErrorCodes.UNKNOWN;
}

/**
 * Wraps any error in a WRAP error
 * @param error - Error to wrap
 * @param message - Optional custom message
 * @returns WRAP error
 */
export function wrapError(error: unknown, message?: string): WRAPError {
  if (error instanceof WRAPError) {
    return error;
  }
  
  const err = error as Error;
  return new WRAPError(
    message ?? err.message ?? 'An unknown error occurred',
    {
      code: ErrorCodes.UNKNOWN,
      recoverable: false,
      cause: err,
    }
  );
}

/**
 * Creates an error from error code
 * @param code - Error code
 * @param message - Error message
 * @param options - Additional options
 * @returns Appropriate error instance
 */
export function createErrorFromCode(
  code: ErrorCode,
  message: string,
  options: Record<string, unknown> = {}
): WRAPError {
  // Map error codes to error classes
  switch (code) {
    case ErrorCodes.INVALID_ARGUMENT:
      return new ArgumentError(message, options as { argumentName?: string });
    case ErrorCodes.INVALID_CONFIGURATION:
      return new ConfigurationError(message, options as { configKey?: string });
    case ErrorCodes.OPERATION_TIMEOUT:
      return new TimeoutError(message, options as { timeoutMs: number });
    case ErrorCodes.OPERATION_CANCELLED:
      return new CancellationError(message, options as { reason?: string });
    case ErrorCodes.NOT_FOUND:
      return new NotFoundError(message, options as { resourceType?: string });
    case ErrorCodes.ALREADY_EXISTS:
      return new AlreadyExistsError(message, options as { resourceType?: string });
    case ErrorCodes.PERMISSION_DENIED:
      return new PermissionError(message, options as { permission: string });
    case ErrorCodes.SAFETY_VIOLATION:
      return new SafetyError(message, options as { violationType: string; severity: 'low' | 'medium' | 'high' | 'critical' });
    case ErrorCodes.CONNECTION_FAILED:
      return new ConnectionError(message, options as { endpoint?: string });
    default:
      return new WRAPError(message, { code, ...options });
  }
}

export default {
  WRAPError,
  ArgumentError,
  ConfigurationError,
  TimeoutError,
  CancellationError,
  ValidationError,
  NotFoundError,
  AlreadyExistsError,
  SandboxError,
  SandboxCreationError,
  SandboxExecutionError,
  SandboxMemoryError,
  SandboxBoundaryError,
  V8IsolateError,
  ContainerError,
  AgentError,
  AgentExecutionError,
  AgentMaxTurnsError,
  LLMProviderError,
  ToolError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolValidationError,
  PermissionError,
  PermissionCheckError,
  SafetyError,
  InjectionError,
  ConnectionError,
  WebSocketError,
  MCPError,
  ErrorCodes,
  isWRAPError,
  isRetryable,
  getErrorCode,
  wrapError,
  createErrorFromCode,
};

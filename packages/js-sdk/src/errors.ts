/**
 * WRAP NEBULA v2.0 - Error Classes
 * Custom error classes for the SDK
 */

export class GhostError extends Error {
  constructor(
    message: string,
    public code: string = 'UNKNOWN_ERROR',
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GhostError';
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

export class ValidationError extends GhostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class SecurityError extends GhostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SECURITY_ERROR', details);
    this.name = 'SecurityError';
  }
}

export class ConnectionError extends GhostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONNECTION_ERROR', details);
    this.name = 'ConnectionError';
  }
}

export class TimeoutError extends GhostError {
  constructor(message: string, public timeout?: number, details?: Record<string, unknown>) {
    super(message, 'TIMEOUT_ERROR', { timeout, ...details });
    this.name = 'TimeoutError';
  }
}

export class QuotaError extends GhostError {
  constructor(message: string, public retryAfter?: number, details?: Record<string, unknown>) {
    super(message, 'QUOTA_ERROR', { retryAfter, ...details });
    this.name = 'QuotaError';
  }
}

export class SandboxError extends GhostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SANDBOX_ERROR', details);
    this.name = 'SandboxError';
  }
}

export class ToolError extends GhostError {
  constructor(message: string, public toolName: string, details?: Record<string, unknown>) {
    super(message, 'TOOL_ERROR', { toolName, ...details });
    this.name = 'ToolError';
  }
}

export class ProviderError extends GhostError {
  constructor(message: string, public provider: string, details?: Record<string, unknown>) {
    super(message, 'PROVIDER_ERROR', { provider, ...details });
    this.name = 'ProviderError';
  }
}

export class RateLimitError extends QuotaError {
  constructor(message: string, retryAfter?: number) {
    super(message, retryAfter);
    this.name = 'RateLimitError';
  }
}

export class PolicyError extends GhostError {
  constructor(message: string, public rule: string, details?: Record<string, unknown>) {
    super(message, 'POLICY_ERROR', { rule, ...details });
    this.name = 'PolicyError';
  }
}

export class AgentError extends GhostError {
  constructor(message: string, public agentId: string, details?: Record<string, unknown>) {
    super(message, 'AGENT_ERROR', { agentId, ...details });
    this.name = 'AgentError';
  }
}

export class ConfigurationError extends GhostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

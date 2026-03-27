/**
 * WRAP NEBULA v2.0 - JavaScript SDK Ghost Client
 * Thin HTTP client for the Core Engine
 */

export { Ghost } from './client';
export type { GhostConfig, RunOptions } from './client';
export type { 
  AgentEvent, 
  ProviderResponse, 
  TokenUsage,
  ToolCall,
  ToolResult,
  Message,
  ContentBlock 
} from './types';
export { InputSanitizer, sanitize, isSafe } from './sanitizer';
export type { SanitizationResult, DetectionResult, DetectionType } from './sanitizer';
export {
  GhostError,
  ValidationError,
  SecurityError,
  ConnectionError,
  TimeoutError,
  QuotaError,
  SandboxError,
} from './errors';

export const VERSION = '2.0.0';

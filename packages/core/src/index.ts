/**
 * WRAP NEBULA v2.0 - Core Engine
 * Main entry point
 */

// Re-export all types
export type * from './types';

// Re-export agent runtime and related
export { AgentRuntime, CircuitBreaker, createProviderClient, getProviderFromModel } from './agent/index';
export type { AgentRuntimeConfig, RunOptions, StepResult, ProviderClient } from './agent/index';

// Re-export tools manager
export { ToolsManager, registerBuiltinTools, createBuiltinTools } from './tools/index';
export type { ToolsManagerConfig, ToolExecutionResult, ToolStats } from './tools/index';

// Re-export VFS
export { VFS } from './vfs/index';

// Re-export sandbox bridge
export { SandboxBridge, InMemorySandbox } from './sandbox/index';

// Re-export secrets manager
export { SecretsManager } from './secrets/index';

// Re-export telemetry
export { Telemetry } from './telemetry/index';

// Re-export state manager
export { StateManager } from './state/index';

// Re-export conversation memory
export { ConversationMemory, createConversationMemory } from './memory/index';
export type { Conversation, ConversationMessage, ConversationMemoryConfig } from './memory/index';

// Re-export MCP server
export { MCPServer } from './mcp/index';

// Re-export server
export { CoreServer, main } from './server';

// Re-export sanitizer
export { InputSanitizer, sanitize, isSafe } from './sanitizer/index';
export type { SanitizationResult, DetectionResult, DetectionType, SanitizerConfig } from './sanitizer/index';

// Re-export policy engine
export { PolicyEngine } from './policy/index';

// Re-export utilities
export * from './utils/index';

// ============================================================================
// NEW: SOUL.md Support
// ============================================================================

export {
  parseSOUL,
  loadSOUL,
  validateSOUL,
  mergeSOULWithConfig,
  generateSystemPrompt,
  ALLOWED_SKILLS,
} from './soul/index';
export type { SOUL, SOULParseOptions, SOULValidation } from './soul/index';

// ============================================================================
// NEW: Skills System
// ============================================================================

export {
  SkillRegistry,
  getSkillRegistry,
  registerSkill,
  executeSkill,
} from './skills/index';
export type {
  SkillDefinition,
  SkillHandler,
  SkillContext,
  SkillResult,
  SkillExample,
  SkillRegistryConfig,
} from './skills/index';

// Export built-in skills
export {
  builtinSkills,
  registerBuiltinSkills,
  webSearchSkill,
  filesReadSkill,
  filesWriteSkill,
  filesListSkill,
  codeRunSkill,
  reminderSetSkill,
  reminderListSkill,
  calendarReadSkill,
  emailSummarySkill,
  gitStatusSkill,
} from './skills/definitions/index';

// ============================================================================
// NEW: Channel Abstraction
// ============================================================================

export {
  BaseChannel,
  ChannelManager,
} from './channels';
export type {
  ChannelType,
  ChannelStatus,
  ChannelConfig,
  IncomingMessage,
  OutgoingMessage,
  ChannelEvents,
  Channel,
} from './channels';

// ============================================================================
// Constants and Error Types
// ============================================================================

export { DEFAULT_BOUNDARIES, DEFAULT_BEHAVIOR } from './types';
export {
  WrapError,
  ValidationError,
  SecurityError,
  SandboxError,
  ProviderError,
  RateLimitError,
  TimeoutError,
  PolicyError,
} from './types';

// Version
export const VERSION = '2.0.0';

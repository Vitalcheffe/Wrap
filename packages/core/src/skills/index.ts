/**
 * WRAP NEBULA Core - Skills System
 * Skill registry and loader
 */

import * as crypto from 'crypto';
import {
  ToolDefinition,
  ToolResult,
  ToolContext,
  ToolHandler,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Skill definition with metadata
 */
export interface SkillDefinition {
  /** Skill identifier (e.g., "web.search") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Category for grouping */
  category: string;
  /** Required permissions */
  permissions: string[];
  /** Whether skill has side effects */
  dangerous: boolean;
  /** JSON schema for parameters */
  parameters: ToolDefinition['parameters'];
  /** Required parameters */
  required?: string[];
  /** Usage examples */
  examples: SkillExample[];
  /** Handler function */
  handler: SkillHandler;
}

/**
 * Skill handler function
 */
export type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillContext
) => Promise<SkillResult>;

/**
 * Skill execution context
 */
export interface SkillContext extends ToolContext {
  /** Agent's SOUL configuration */
  soul?: {
    name: string;
    personality: string;
    language: string;
    rules: string[];
  };
}

/**
 * Skill execution result
 */
export interface SkillResult {
  success: boolean;
  output: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Skill usage example
 */
export interface SkillExample {
  description: string;
  params: Record<string, unknown>;
  result: unknown;
}

/**
 * Skill registry configuration
 */
export interface SkillRegistryConfig {
  /** Allowed skills (whitelist) */
  allowedSkills?: string[];
  /** Denied skills (blacklist) */
  deniedSkills?: string[];
  /** Default timeout in ms */
  defaultTimeout?: number;
}

// ============================================================================
// Skill Registry Implementation
// ============================================================================

/**
 * Registry for managing skills
 */
export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private categories: Map<string, Set<string>> = new Map();
  private config: SkillRegistryConfig;

  constructor(config: SkillRegistryConfig = {}) {
    this.config = {
      defaultTimeout: 30000,
      ...config,
    };
  }

  /**
   * Register a skill
   */
  register(skill: SkillDefinition): void {
    // Validate skill
    this.validateSkill(skill);

    // Check against whitelist/blacklist
    if (this.config.allowedSkills && !this.config.allowedSkills.includes(skill.name)) {
      throw new Error(`Skill ${skill.name} is not in the allowed list`);
    }
    if (this.config.deniedSkills?.includes(skill.name)) {
      throw new Error(`Skill ${skill.name} is denied`);
    }

    // Add to registry
    this.skills.set(skill.name, skill);

    // Add to category
    if (!this.categories.has(skill.category)) {
      this.categories.set(skill.category, new Set());
    }
    this.categories.get(skill.category)!.add(skill.name);
  }

  /**
   * Unregister a skill
   */
  unregister(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    this.skills.delete(name);

    // Remove from category
    const categorySkills = this.categories.get(skill.category);
    if (categorySkills) {
      categorySkills.delete(name);
      if (categorySkills.size === 0) {
        this.categories.delete(skill.category);
      }
    }

    return true;
  }

  /**
   * Get skill definition
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * Check if skill exists
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * List all skills
   */
  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * List skills by category
   */
  listByCategory(category: string): SkillDefinition[] {
    const skillNames = this.categories.get(category);
    if (!skillNames) return [];

    return Array.from(skillNames)
      .map(name => this.skills.get(name))
      .filter((s): s is SkillDefinition => s !== undefined);
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Execute a skill
   */
  async execute(
    name: string,
    params: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) {
      return {
        success: false,
        output: null,
        error: `Skill not found: ${name}`,
      };
    }

    try {
      // Validate parameters
      this.validateParameters(skill, params);

      // Execute handler
      const result = await skill.handler(params, context);

      return result;
    } catch (error) {
      return {
        success: false,
        output: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Convert skill to tool definition for agent
   */
  toToolDefinition(name: string): ToolDefinition | undefined {
    const skill = this.skills.get(name);
    if (!skill) return undefined;

    return {
      name: skill.name,
      description: skill.description,
      parameters: skill.parameters,
      required: skill.required,
      dangerous: skill.dangerous,
      permissions: skill.permissions,
    };
  }

  /**
   * Get tool handler for agent
   */
  getToolHandler(name: string): ToolHandler | undefined {
    const skill = this.skills.get(name);
    if (!skill) return undefined;

    return async (params: Record<string, unknown>, context: ToolContext) => {
      const skillContext: SkillContext = context;
      const result = await skill.handler(params, skillContext);
      
      return {
        success: result.success,
        output: result.output,
        error: result.error,
        metadata: result.metadata,
      } as ToolResult;
    };
  }

  /**
   * Validate skill definition
   */
  private validateSkill(skill: SkillDefinition): void {
    if (!skill.name || typeof skill.name !== 'string') {
      throw new Error('Skill name is required');
    }

    if (!skill.name.match(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/)) {
      throw new Error(`Invalid skill name: ${skill.name}. Use lowercase with dots (e.g., "web.search")`);
    }

    if (!skill.description || typeof skill.description !== 'string') {
      throw new Error('Skill description is required');
    }

    if (!skill.category || typeof skill.category !== 'string') {
      throw new Error('Skill category is required');
    }

    if (!skill.handler || typeof skill.handler !== 'function') {
      throw new Error('Skill handler is required');
    }
  }

  /**
   * Validate parameters against skill schema
   */
  private validateParameters(skill: SkillDefinition, params: Record<string, unknown>): void {
    if (skill.required) {
      for (const field of skill.required) {
        if (params[field] === undefined) {
          throw new Error(`Missing required parameter: ${field}`);
        }
      }
    }
  }
}

// ============================================================================
// Global Registry Instance
// ============================================================================

let globalRegistry: SkillRegistry | null = null;

/**
 * Get global skill registry
 */
export function getSkillRegistry(): SkillRegistry {
  if (!globalRegistry) {
    globalRegistry = new SkillRegistry();
  }
  return globalRegistry;
}

/**
 * Register a skill in the global registry
 */
export function registerSkill(skill: SkillDefinition): void {
  getSkillRegistry().register(skill);
}

/**
 * Execute a skill using the global registry
 */
export async function executeSkill(
  name: string,
  params: Record<string, unknown>,
  context: SkillContext
): Promise<SkillResult> {
  return getSkillRegistry().execute(name, params, context);
}

// ============================================================================
// Exports
// ============================================================================

export { ALLOWED_SKILLS } from './definitions/index.js';

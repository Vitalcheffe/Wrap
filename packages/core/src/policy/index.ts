/**
 * WRAP NEBULA v2.0 - Policy Engine
 * YAML-based policy management with hot-reload
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { PolicyConfig, PolicyRule, PolicyCondition, PolicyTransform, PolicyError } from '../types';

// ============================================================================
// Types
// ============================================================================

interface PolicyCheckContext {
  type: string;
  [key: string]: unknown;
}

interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  rule?: string;
  transformed?: unknown;
}

interface PolicyFile {
  version: string;
  defaultAction: 'allow' | 'deny';
  rules: PolicyRule[];
}

// ============================================================================
// Policy Engine Implementation
// ============================================================================

export class PolicyEngine extends EventEmitter {
  private config: PolicyConfig;
  private rules: Map<string, PolicyRule> = new Map();
  private policyPath: string | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private lastModified: number = 0;

  constructor(config: Partial<PolicyConfig> = {}) {
    super();
    this.config = {
      rules: config.rules || [],
      defaultAction: config.defaultAction || 'allow',
      auditMode: config.auditMode || false,
    };

    // Add initial rules
    for (const rule of this.config.rules) {
      this.rules.set(rule.id, rule);
    }
  }

  /**
   * Load policy from file
   */
  async loadFromFile(filePath: string): Promise<void> {
    this.policyPath = filePath;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const policy = this.parseYAML(content);
      this.applyPolicy(policy);

      // Start watching for changes
      this.startWatching();
    } catch (error) {
      // If file doesn't exist, create default policy
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.createDefaultPolicy(filePath);
      } else {
        throw error;
      }
    }
  }

  /**
   * Parse YAML content (simple implementation)
   */
  private parseYAML(content: string): PolicyFile {
    // Simple YAML parser for policy files
    // In production, use a proper YAML library
    const lines = content.split('\n');
    const policy: PolicyFile = {
      version: '1.0',
      defaultAction: 'allow',
      rules: [],
    };

    let currentRule: Partial<PolicyRule> | null = null;
    let inRules = false;
    let indent = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const currentIndent = line.search(/\S/);

      if (trimmed === 'rules:') {
        inRules = true;
        continue;
      }

      if (trimmed.startsWith('version:')) {
        policy.version = trimmed.split(':')[1].trim().replace(/['"]/g, '');
      } else if (trimmed.startsWith('default_action:')) {
        policy.defaultAction = trimmed.split(':')[1].trim() as 'allow' | 'deny';
      } else if (inRules && currentIndent > 0) {
        if (currentIndent === 2 && trimmed.startsWith('- ')) {
          // New rule
          if (currentRule && currentRule.id) {
            policy.rules.push(currentRule as PolicyRule);
          }
          currentRule = { id: trimmed.slice(2).trim() };
        } else if (currentRule) {
          const colonIndex = trimmed.indexOf(':');
          if (colonIndex > 0) {
            const key = trimmed.slice(0, colonIndex).trim();
            const value = trimmed.slice(colonIndex + 1).trim();

            if (key === 'name') currentRule.name = value.replace(/['"]/g, '');
            else if (key === 'description') currentRule.description = value.replace(/['"]/g, '');
            else if (key === 'action') currentRule.action = value as 'allow' | 'deny' | 'transform';
            else if (key === 'priority') currentRule.priority = parseInt(value);
            else if (key === 'enabled') currentRule.enabled = value === 'true';
          }
        }
      }
    }

    // Add last rule
    if (currentRule && currentRule.id) {
      policy.rules.push(currentRule as PolicyRule);
    }

    return policy;
  }

  /**
   * Apply loaded policy
   */
  private applyPolicy(policy: PolicyFile): void {
    this.config.defaultAction = policy.defaultAction;
    this.rules.clear();

    for (const rule of policy.rules) {
      this.rules.set(rule.id, {
        ...rule,
        priority: rule.priority || 100,
        enabled: rule.enabled !== false,
      });
    }

    this.lastModified = Date.now();
    this.emit('policyLoaded', { ruleCount: this.rules.size });
  }

  /**
   * Create default policy file
   */
  private async createDefaultPolicy(filePath: string): Promise<void> {
    const defaultPolicy = `# WRAP NEBULA Default Policy
version: "1.0"
default_action: allow

rules:
  - block_dangerous_commands:
    name: Block Dangerous Commands
    description: Block shell commands that could harm the system
    action: deny
    priority: 1
    enabled: true

  - block_external_networks:
    name: Block External Networks
    description: Block requests to external networks not in whitelist
    action: deny
    priority: 10
    enabled: true

  - rate_limit_api:
    name: Rate Limit API Calls
    description: Limit API calls to prevent abuse
    action: allow
    priority: 100
    enabled: true
`;

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, defaultPolicy, 'utf-8');
    
    const policy = this.parseYAML(defaultPolicy);
    this.applyPolicy(policy);
  }

  /**
   * Start watching policy file for changes
   */
  private startWatching(): void {
    if (!this.policyPath) return;

    this.fileWatcher = fs.watch(this.policyPath, async (event) => {
      if (event === 'change') {
        try {
          const content = await fs.promises.readFile(this.policyPath!, 'utf-8');
          const policy = this.parseYAML(content);
          this.applyPolicy(policy);
          this.emit('policyReloaded', { ruleCount: this.rules.size });
        } catch (error) {
          this.emit('policyError', { error });
        }
      }
    });
  }

  /**
   * Stop watching policy file
   */
  stopWatching(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  // ==========================================================================
  // Policy Checking
  // ==========================================================================

  /**
   * Check if action is allowed
   */
  async check(context: PolicyCheckContext): Promise<PolicyCheckResult> {
    // Sort rules by priority
    const sortedRules = Array.from(this.rules.values())
      .filter(r => r.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const matches = this.matchesRule(rule, context);

      if (matches) {
        if (this.config.auditMode) {
          // In audit mode, just log but don't block
          this.emit('audit', { rule: rule.id, context, action: rule.action });
        } else {
          // Apply rule action
          switch (rule.action) {
            case 'deny':
              return { allowed: false, reason: rule.description, rule: rule.id };

            case 'transform':
              return {
                allowed: true,
                rule: rule.id,
                transformed: this.applyTransform(context, rule.transform),
              };

            case 'allow':
              return { allowed: true, rule: rule.id };
          }
        }
      }
    }

    // No rules matched, use default action
    return {
      allowed: this.config.defaultAction === 'allow',
      reason: this.config.defaultAction === 'deny' ? 'Default deny policy' : undefined,
    };
  }

  /**
   * Check if context matches rule
   */
  private matchesRule(rule: PolicyRule, context: PolicyCheckContext): boolean {
    const condition = rule.condition;

    // Check condition type matches context type
    if (condition.type && condition.type !== context.type) {
      return false;
    }

    // Check pattern match
    if (condition.pattern) {
      const value = this.getContextValue(context, condition.field);
      if (value === undefined) return false;

      const regex = new RegExp(condition.pattern, 'i');
      if (condition.operator === 'matches') {
        return regex.test(String(value));
      }
    }

    // Check multiple patterns
    if (condition.patterns && condition.patterns.length > 0) {
      const value = String(this.getContextValue(context, condition.field) || '');
      for (const pattern of condition.patterns) {
        if (new RegExp(pattern, 'i').test(value)) {
          return true;
        }
      }
      return false;
    }

    // Check equality
    if (condition.value !== undefined && condition.field) {
      const value = this.getContextValue(context, condition.field);
      if (condition.operator === 'equals') {
        return value === condition.value;
      }
      if (condition.operator === 'contains') {
        return String(value).includes(String(condition.value));
      }
    }

    // Default: rule matches if type matches
    return true;
  }

  /**
   * Get value from context by field path
   */
  private getContextValue(context: PolicyCheckContext, field?: string): unknown {
    if (!field) return undefined;

    const parts = field.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Apply transform to context
   */
  private applyTransform(context: PolicyCheckContext, transform?: PolicyTransform): unknown {
    if (!transform) return context;

    // Apply redaction/masking
    if (transform.type === 'redact' || transform.type === 'mask') {
      const value = String(this.getContextValue(context, transform.pattern.includes('.') ? transform.pattern : '') || '');
      return value.replace(new RegExp(transform.pattern, 'g'), transform.replacement || '***');
    }

    return context;
  }

  // ==========================================================================
  // Rule Management
  // ==========================================================================

  /**
   * Add rule
   */
  addRule(rule: PolicyRule): void {
    this.rules.set(rule.id, rule);
    this.emit('ruleAdded', { ruleId: rule.id });
  }

  /**
   * Remove rule
   */
  removeRule(id: string): boolean {
    const result = this.rules.delete(id);
    if (result) {
      this.emit('ruleRemoved', { ruleId: id });
    }
    return result;
  }

  /**
   * Update rule
   */
  updateRule(id: string, updates: Partial<PolicyRule>): boolean {
    const existing = this.rules.get(id);
    if (!existing) return false;

    this.rules.set(id, { ...existing, ...updates });
    this.emit('ruleUpdated', { ruleId: id });
    return true;
  }

  /**
   * Get rule
   */
  getRule(id: string): PolicyRule | undefined {
    return this.rules.get(id);
  }

  /**
   * List all rules
   */
  listRules(): PolicyRule[] {
    return Array.from(this.rules.values());
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get config
   */
  getConfig(): PolicyConfig {
    return {
      ...this.config,
      rules: this.listRules(),
    };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<PolicyConfig>): void {
    if (config.defaultAction) {
      this.config.defaultAction = config.defaultAction;
    }
    if (config.auditMode !== undefined) {
      this.config.auditMode = config.auditMode;
    }
    if (config.rules) {
      this.rules.clear();
      for (const rule of config.rules) {
        this.rules.set(rule.id, rule);
      }
    }
    this.emit('configUpdated');
  }

  /**
   * Export policy as YAML
   */
  exportYAML(): string {
    let yaml = `# WRAP NEBULA Policy
version: "1.0"
default_action: ${this.config.defaultAction}

rules:
`;

    for (const rule of this.rules.values()) {
      yaml += `  - ${rule.id}:
    name: "${rule.name}"
    description: "${rule.description}"
    action: ${rule.action}
    priority: ${rule.priority}
    enabled: ${rule.enabled}
`;
    }

    return yaml;
  }
}

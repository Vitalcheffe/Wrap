/**
 * WRAP NEBULA Core - SOUL.md Parser and Loader
 * Agent personality definition system
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed SOUL.md configuration
 */
export interface SOUL {
  /** Agent name */
  name: string;
  /** Personality description */
  personality: string;
  /** Preferred language */
  language: string;
  /** Enabled skills/capabilities */
  skills: string[];
  /** Behavioral rules */
  rules: string[];
  /** Full markdown content */
  content: string;
  /** Parsed frontmatter metadata */
  metadata: Record<string, unknown>;
}

/**
 * SOUL.md parsing options
 */
export interface SOULParseOptions {
  /** Allowed skills (for validation) */
  allowedSkills?: string[];
  /** Default values if not specified */
  defaults?: Partial<SOUL>;
}

/**
 * SOUL.md validation result
 */
export interface SOULValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SOUL: SOUL = {
  name: 'Aria',
  personality: 'Assistante curieuse et directe',
  language: 'Français',
  skills: ['web.search', 'files.read'],
  rules: [
    'Ne jamais partager mes clés API',
    'Demander confirmation avant de supprimer',
  ],
  content: '',
  metadata: {},
};

const ALLOWED_SKILLS = [
  'web.search',
  'files.read',
  'files.write',
  'files.list',
  'code.run',
  'reminder.set',
  'reminder.list',
  'calendar.read',
  'email.summary',
  'git.status',
];

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * Parse SOUL.md content
 */
export function parseSOUL(content: string, options: SOULParseOptions = {}): SOUL {
  const { allowedSkills = ALLOWED_SKILLS, defaults = {} } = options;
  
  // Extract frontmatter
  const { frontmatter, body } = extractFrontmatter(content);
  
  // Parse frontmatter
  const parsed = parseFrontmatter(frontmatter);
  
  // Extract values with proper type casting
  const parsedName = typeof parsed.name === 'string' ? parsed.name : undefined;
  const parsedPersonality = typeof parsed.personality === 'string' ? parsed.personality : undefined;
  const parsedLanguage = typeof parsed.language === 'string' ? parsed.language : undefined;
  const parsedSkills = Array.isArray(parsed.skills) ? parsed.skills as string[] : undefined;
  const parsedRules = Array.isArray(parsed.rules) ? parsed.rules as string[] : undefined;
  
  // Build SOUL object
  const soul: SOUL = {
    name: parsedName || defaults.name || DEFAULT_SOUL.name,
    personality: parsedPersonality || defaults.personality || DEFAULT_SOUL.personality,
    language: parsedLanguage || defaults.language || DEFAULT_SOUL.language,
    skills: validateSkills(parsedSkills || defaults.skills || DEFAULT_SOUL.skills, allowedSkills),
    rules: parsedRules || defaults.rules || DEFAULT_SOUL.rules,
    content: body,
    metadata: parsed,
  };

  return soul;
}

/**
 * Load SOUL.md from file
 */
export function loadSOUL(filePath: string, options: SOULParseOptions = {}): SOUL {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`SOUL.md file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return parseSOUL(content, options);
  } catch (error) {
    throw new Error(`Failed to load SOUL.md: ${(error as Error).message}`);
  }
}

/**
 * Validate SOUL.md content
 */
export function validateSOUL(content: string, options: SOULParseOptions = {}): SOULValidation {
  const result: SOULValidation = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const { allowedSkills = ALLOWED_SKILLS } = options;

  try {
    const soul = parseSOUL(content, options);

    // Check required fields
    if (!soul.name || soul.name.trim().length === 0) {
      result.errors.push('Agent name is required');
      result.valid = false;
    }

    if (!soul.personality || soul.personality.trim().length === 0) {
      result.warnings.push('Personality description is empty');
    }

    // Validate skills
    for (const skill of soul.skills) {
      if (!allowedSkills.includes(skill)) {
        result.warnings.push(`Unknown skill: ${skill}`);
      }
    }

    // Check for dangerous rules
    const dangerousPatterns = [
      /api\s*key/i,
      /password/i,
      /secret/i,
      /token/i,
    ];

    for (const rule of soul.rules) {
      for (const pattern of dangerousPatterns) {
        if (pattern.test(rule)) {
          result.warnings.push(`Rule may contain sensitive information: "${rule.substring(0, 50)}..."`);
        }
      }
    }

  } catch (error) {
    result.errors.push((error as Error).message);
    result.valid = false;
  }

  return result;
}

/**
 * Merge SOUL with runtime configuration
 */
export function mergeSOULWithConfig(
  soul: SOUL,
  config: { skills?: string[]; rules?: string[] }
): SOUL {
  return {
    ...soul,
    skills: [...new Set([...soul.skills, ...(config.skills || [])])],
    rules: [...new Set([...soul.rules, ...(config.rules || [])])],
  };
}

/**
 * Generate system prompt from SOUL
 */
export function generateSystemPrompt(soul: SOUL): string {
  const lines: string[] = [];

  lines.push(`# ${soul.name}`);
  lines.push('');
  lines.push(`Tu es ${soul.name}, ${soul.personality}.`);
  lines.push('');
  lines.push(`Langue: ${soul.language}`);
  lines.push('');

  if (soul.skills.length > 0) {
    lines.push('## Capacités');
    lines.push('');
    for (const skill of soul.skills) {
      lines.push(`- ${skill}`);
    }
    lines.push('');
  }

  if (soul.rules.length > 0) {
    lines.push('## Règles');
    lines.push('');
    for (const rule of soul.rules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (soul.content) {
    lines.push('## Contexte');
    lines.push('');
    lines.push(soul.content);
  }

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract frontmatter from markdown content
 */
function extractFrontmatter(content: string): { frontmatter: string; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (match) {
    return {
      frontmatter: match[1],
      body: match[2].trim(),
    };
  }

  // No frontmatter, try to parse as inline metadata
  return {
    frontmatter: parseInlineMetadata(content),
    body: content,
  };
}

/**
 * Parse inline metadata (e.g., "Nom: Aria")
 */
function parseInlineMetadata(content: string): string {
  const lines = content.split('\n');
  const metadata: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      metadata.push(`${key}: ${value}`);
    }
  }

  return metadata.join('\n');
}

/**
 * Parse frontmatter string to object
 */
function parseFrontmatter(frontmatter: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = frontmatter.split('\n');

  let currentKey: string | null = null;
  let currentList: string[] = [];

  for (const line of lines) {
    // List item
    const listMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (listMatch && currentKey) {
      currentList.push(listMatch[1]);
      continue;
    }

    // Save previous key if we have a list
    if (currentKey && currentList.length > 0) {
      result[currentKey] = currentList;
      currentList = [];
    }

    // Key-value pair
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      currentKey = key.toLowerCase();

      if (value) {
        result[currentKey] = value;
        currentKey = null;
      }
    }
  }

  // Save last list if any
  if (currentKey && currentList.length > 0) {
    result[currentKey] = currentList;
  }

  return result;
}

/**
 * Validate and filter skills
 */
function validateSkills(skills: unknown, allowedSkills: string[]): string[] {
  if (!skills) return [];
  
  const skillArray = Array.isArray(skills) ? skills : [skills];
  
  return skillArray.filter(skill => {
    if (typeof skill !== 'string') return false;
    // Allow if in allowed list or if it matches pattern
    return allowedSkills.includes(skill) || skill.includes('.');
  });
}

// ============================================================================
// Exports
// ============================================================================

export { ALLOWED_SKILLS };

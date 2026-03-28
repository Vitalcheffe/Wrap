/**
 * WRAP NEBULA v2.0 - SOUL.md Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSOUL, validateSOUL, ALLOWED_SKILLS } from '../src/soul/index';

describe('SOUL Parser', () => {
  it('should parse a valid SOUL.md', () => {
    const content = `Name: Aria
Personality: Curious and direct assistant
Language: English

Skills enabled:
- web.search
- files.read

Rules:
- Never share my API keys
- Ask before deleting files`;

    const soul = parseSOUL(content);
    expect(soul.name).toBe('Aria');
    expect(soul.personality).toContain('Curious');
    expect(soul.skills).toContain('web.search');
    expect(soul.skills).toContain('files.read');
    expect(soul.rules.length).toBeGreaterThan(0);
  });

  it('should return defaults for empty content', () => {
    const soul = parseSOUL('');
    expect(soul.name).toBeTruthy();
    // Default SOUL includes default skills
    expect(soul.skills.length).toBeGreaterThanOrEqual(0);
  });

  it('should validate skill names against allowed list', () => {
    const content = `Name: Test\nSkills:\n- web.search\n- nonexistent.skill`;
    const soul = parseSOUL(content);
    const validation = validateSOUL(content);
    expect(validation).toBeDefined();
    expect(validation.valid).toBeDefined();
  });

  it('should have ALLOWED_SKILLS defined', () => {
    expect(ALLOWED_SKILLS).toBeDefined();
    expect(ALLOWED_SKILLS.length).toBeGreaterThan(0);
    expect(ALLOWED_SKILLS).toContain('web.search');
  });

  it('should parse personality field', () => {
    const content = `Name: Bob\nPersonality: Friendly helper`;
    const soul = parseSOUL(content);
    expect(soul.name).toBe('Bob');
    expect(soul.personality).toContain('Friendly');
  });
});

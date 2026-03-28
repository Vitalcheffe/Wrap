/**
 * WRAP NEBULA Core - Skills Definitions Index
 * Export all skill definitions
 */

import { SkillRegistry, registerSkill } from '../index.js';

// Import all skill definitions
import { webSearchSkill } from './web.search.js';
import { filesReadSkill } from './files.read.js';
import { filesWriteSkill } from './files.write.js';
import { filesListSkill } from './files.list.js';
import { codeRunSkill } from './code.run.js';
import { reminderSetSkill } from './reminder.set.js';
import { reminderListSkill } from './reminder.list.js';
import { calendarReadSkill } from './calendar.read.js';
import { emailSummarySkill } from './email.summary.js';
import { gitStatusSkill } from './git.status.js';
import { codeEditSkill } from './code.edit.js';
import { codeSearchSkill } from './code.search.js';
import { terminalRunSkill } from './terminal.run.js';
import { projectContextSkill } from './project.context.js';

// Re-export all skills
export {
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
  codeEditSkill,
  codeSearchSkill,
  terminalRunSkill,
  projectContextSkill,
};

// List of all built-in skills
export const builtinSkills = [
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
  codeEditSkill,
  codeSearchSkill,
  terminalRunSkill,
  projectContextSkill,
];

// Allowed skills list for validation
export const ALLOWED_SKILLS = builtinSkills.map(s => s.name);

/**
 * Register all built-in skills
 */
export function registerBuiltinSkills(registry?: SkillRegistry): SkillRegistry {
  const reg = registry || new SkillRegistry();

  for (const skill of builtinSkills) {
    try {
      reg.register(skill);
    } catch (error) {
      console.error(`Failed to register skill ${skill.name}:`, error);
    }
  }

  return reg;
}

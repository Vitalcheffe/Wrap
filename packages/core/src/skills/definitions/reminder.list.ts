/**
 * WRAP NEBULA Core - Reminder List Skill
 * List reminders
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import { reminders } from './reminder.set.js';

export const reminderListSkill: SkillDefinition = {
  name: 'reminder.list',
  description: 'List all reminders',
  category: 'productivity',
  permissions: ['reminders:read'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      includeCompleted: {
        type: 'boolean',
        description: 'Include completed reminders',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of reminders to return',
        minimum: 1,
        maximum: 100,
      },
    },
  },
  examples: [
    {
      description: 'List active reminders',
      params: {},
      result: { reminders: [{ id: 'rem_123', message: 'Take a break' }] },
    },
  ],
  handler: async (params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> => {
    const includeCompleted = (params.includeCompleted as boolean) ?? false;
    const limit = (params.limit as number) || 20;

    try {
      const allReminders = Array.from(reminders.values())
        .filter(r => r.userId === context.agentId)
        .filter(r => includeCompleted || !r.completed)
        .sort((a, b) => a.scheduledFor - b.scheduledFor)
        .slice(0, limit);

      return {
        success: true,
        output: {
          reminders: allReminders.map(r => ({
            id: r.id,
            message: r.message,
            scheduledFor: new Date(r.scheduledFor).toISOString(),
            completed: r.completed,
            overdue: !r.completed && r.scheduledFor < Date.now(),
          })),
          total: allReminders.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Failed to list reminders: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * WRAP NEBULA Core - Reminder Set Skill
 * Create reminders
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';

// In-memory reminder storage (would be database in production)
const reminders: Map<string, Reminder> = new Map();

interface Reminder {
  id: string;
  message: string;
  scheduledFor: number;
  createdAt: number;
  userId: string;
  completed: boolean;
}

export const reminderSetSkill: SkillDefinition = {
  name: 'reminder.set',
  description: 'Create a reminder for a future time',
  category: 'productivity',
  permissions: ['reminders:write'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Reminder message',
      },
      when: {
        type: 'string',
        description: 'When to remind (ISO date string or relative time like "in 5 minutes")',
      },
      recurring: {
        type: 'boolean',
        description: 'Whether this is a recurring reminder',
      },
    },
    required: ['message', 'when'],
  },
  required: ['message', 'when'],
  examples: [
    {
      description: 'Set a reminder for 30 minutes',
      params: { message: 'Take a break', when: 'in 30 minutes' },
      result: { id: 'rem_123', scheduledFor: '2024-01-15T10:30:00Z' },
    },
  ],
  handler: async (params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> => {
    const message = params.message as string;
    const when = params.when as string;
    const recurring = (params.recurring as boolean) ?? false;

    try {
      // Parse the time
      const scheduledFor = parseTime(when);
      if (!scheduledFor) {
        return {
          success: false,
          output: null,
          error: `Could not parse time: ${when}`,
        };
      }

      // Create reminder
      const reminder: Reminder = {
        id: `rem_${Date.now()}`,
        message,
        scheduledFor: scheduledFor.getTime(),
        createdAt: Date.now(),
        userId: context.agentId,
        completed: false,
      };

      reminders.set(reminder.id, reminder);

      return {
        success: true,
        output: {
          id: reminder.id,
          message: reminder.message,
          scheduledFor: scheduledFor.toISOString(),
          inMinutes: Math.round((scheduledFor.getTime() - Date.now()) / 60000),
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Failed to create reminder: ${(error as Error).message}`,
      };
    }
  },
};

function parseTime(timeStr: string): Date | null {
  // Try ISO format first
  const isoDate = new Date(timeStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Parse relative time
  const relativeMatch = timeStr.match(/^in\s+(\d+)\s+(second|minute|hour|day)s?$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();

    const now = new Date();
    switch (unit) {
      case 'second':
        now.setSeconds(now.getSeconds() + amount);
        break;
      case 'minute':
        now.setMinutes(now.getMinutes() + amount);
        break;
      case 'hour':
        now.setHours(now.getHours() + amount);
        break;
      case 'day':
        now.setDate(now.getDate() + amount);
        break;
    }
    return now;
  }

  return null;
}

// Export reminders for the list skill
export { reminders };

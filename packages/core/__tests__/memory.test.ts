/**
 * WRAP NEBULA v2.0 - Memory Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationMemory } from '../src/memory/conversation';
import { StateManager } from '../src/state/index';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('ConversationMemory', () => {
  let memory: ConversationMemory;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-mem-test-'));
    const stateManager = new StateManager({ backend: 'file', filePath: path.join(tmpDir, 'state.json') });
    memory = new ConversationMemory({ stateManager });
    await memory.initialize();
  });

  afterEach(async () => {
    await memory.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a conversation', async () => {
    const conv = await memory.createConversation('user1', 'channel1', 'telegram');
    expect(conv.id).toBeDefined();
    expect(conv.messages).toHaveLength(0);
    expect(conv.userId).toBe('user1');
  });

  it('should add messages to conversation', async () => {
    const conv = await memory.createConversation('user1', 'channel1', 'telegram');
    await memory.addMessage(conv.id, {
      role: 'user',
      content: 'Hello',
    });
    const updated = await memory.getConversation(conv.id);
    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.messages.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should get non-existent conversation as null', async () => {
    const conv = await memory.getConversation('does-not-exist');
    expect(conv).toBeNull();
  });

  it('should delete a conversation', async () => {
    const conv = await memory.createConversation('user1', 'channel1', 'telegram');
    await memory.deleteConversation(conv.id);
    const deleted = await memory.getConversation(conv.id);
    expect(deleted).toBeNull();
  });

  it('should find conversations by user', async () => {
    await memory.createConversation('userA', 'ch1', 'telegram');
    await memory.createConversation('userA', 'ch2', 'discord');
    const userConvs = await memory.getConversationsByUser('userA');
    expect(userConvs.length).toBeGreaterThanOrEqual(2);
  });
});

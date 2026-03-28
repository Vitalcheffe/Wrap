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
    const stateManager = new StateManager({ backend: 'file', path: path.join(tmpDir, 'state.json') });
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
    await memory.addMessage('user1', 'channel1', 'telegram', 'user', 'Hello');
    const updated = await memory.getConversation('user1', 'channel1');
    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.messages.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should get non-existent conversation as null', async () => {
    const conv = await memory.getConversation('nonexistent-user', 'nonexistent-channel');
    expect(conv).toBeNull();
  });

  it('should delete a conversation', async () => {
    await memory.createConversation('user1', 'channel1', 'telegram');
    await memory.deleteConversation('user1', 'channel1');
    const deleted = await memory.getConversation('user1', 'channel1');
    expect(deleted).toBeNull();
  });

  it('should find conversations by user', async () => {
    await memory.createConversation('userA', 'ch1', 'telegram');
    await memory.createConversation('userA', 'ch2', 'discord');
    const conv1 = await memory.getConversation('userA', 'ch1');
    const conv2 = await memory.getConversation('userA', 'ch2');
    expect(conv1).not.toBeNull();
    expect(conv2).not.toBeNull();
    expect(conv1?.userId).toBe('userA');
    expect(conv2?.userId).toBe('userA');
  });

  it('should get recent messages', async () => {
    await memory.createConversation('user1', 'channel1', 'telegram');
    await memory.addMessage('user1', 'channel1', 'telegram', 'user', 'First message');
    await memory.addMessage('user1', 'channel1', 'telegram', 'assistant', 'Response');
    const messages = await memory.getRecentMessages('user1', 'channel1', 10);
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe('First message');
    expect(messages[1].content).toBe('Response');
  });

  it('should set and get context', async () => {
    await memory.createConversation('user1', 'channel1', 'telegram');
    await memory.setContext('user1', 'channel1', 'key', 'value');
    const value = await memory.getContext('user1', 'channel1', 'key');
    expect(value).toBe('value');
  });
});

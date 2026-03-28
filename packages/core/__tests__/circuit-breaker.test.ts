/**
 * WRAP NEBULA v2.0 - Circuit Breaker Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../src/agent/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      volumeThreshold: 1,
    });
  });

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should have initial stats', () => {
    const stats = breaker.getStats();
    expect(stats.state).toBe('CLOSED');
    expect(stats.failures).toBe(0);
    expect(stats.totalCalls).toBe(0);
  });

  it('should record calls via execute', async () => {
    const result = await breaker.execute(async () => 'success');
    expect(result).toBe('success');
    const stats = breaker.getStats();
    expect(stats.totalCalls).toBe(1);
    expect(stats.successes).toBe(1);
  });

  it('should open after threshold failures', async () => {
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
    }
    expect(breaker.getState()).toBe('OPEN');
  });

  it('should throw when OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
    }
    await expect(breaker.execute(async () => 'ok')).rejects.toThrow();
  });
});

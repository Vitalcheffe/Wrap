/**
 * WRAP NEBULA v2.0 - Circuit Breaker
 * Implements the Circuit Breaker pattern for fault tolerance
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
  volumeThreshold: number;
  errorFilter?: (error: Error) => boolean;
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
  fallback?: (...args: unknown[]) => Promise<unknown>;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  rejects: number;
  timeouts: number;
  totalCalls: number;
  lastFailure?: number;
  lastSuccess?: number;
  lastStateChange?: number;
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private rejects: number = 0;
  private timeouts: number = 0;
  private totalCalls: number = 0;
  private lastFailure?: number;
  private lastSuccess?: number;
  private lastStateChange?: number;
  private resetTimer?: NodeJS.Timeout;
  private halfOpenCalls: number = 0;

  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 3,
      timeout: config.timeout ?? 30000,
      resetTimeout: config.resetTimeout ?? 60000,
      volumeThreshold: config.volumeThreshold ?? 10,
      errorFilter: config.errorFilter,
      onStateChange: config.onStateChange,
      fallback: config.fallback,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if circuit is open
    if (this.state === 'OPEN') {
      this.rejects++;
      this.emit('reject', { state: this.state, rejects: this.rejects });
      
      if (this.config.fallback) {
        return this.config.fallback() as Promise<T>;
      }
      
      throw new CircuitBreakerError('Circuit breaker is OPEN', this.getStats());
    }

    // Handle half-open state
    if (this.state === 'HALF_OPEN') {
      return this.executeHalfOpen(fn);
    }

    // Execute in closed state
    return this.executeClosed(fn);
  }

  /**
   * Execute with timeout protection
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.timeouts++;
        reject(new CircuitBreakerTimeoutError('Operation timed out', this.config.timeout));
      }, this.config.timeout);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Execute in closed state
   */
  private async executeClosed<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  /**
   * Execute in half-open state
   */
  private async executeHalfOpen<T>(fn: () => Promise<T>): Promise<T> {
    this.halfOpenCalls++;

    try {
      const result = await this.executeWithTimeout(fn);
      this.onHalfOpenSuccess();
      return result;
    } catch (error) {
      this.onHalfOpenFailure(error as Error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successes++;
    this.lastSuccess = Date.now();
    this.failures = 0;
    this.emit('success', { successes: this.successes });
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: Error): void {
    // Check if error should be counted
    if (this.config.errorFilter && !this.config.errorFilter(error)) {
      return;
    }

    this.failures++;
    this.lastFailure = Date.now();
    this.emit('failure', { failures: this.failures, error });

    // Check if should trip
    if (this.shouldTrip()) {
      this.trip();
    }
  }

  /**
   * Handle success in half-open state
   */
  private onHalfOpenSuccess(): void {
    this.successes++;
    this.lastSuccess = Date.now();

    // Check if we've had enough successes to close
    const halfOpenSuccesses = this.successes;
    if (halfOpenSuccesses >= this.config.successThreshold) {
      this.close();
    }
  }

  /**
   * Handle failure in half-open state
   */
  private onHalfOpenFailure(error: Error): void {
    this.failures++;
    this.lastFailure = Date.now();
    this.emit('halfOpenFailure', { failures: this.failures, error });
    
    // Immediately trip back to open
    this.trip();
  }

  /**
   * Check if circuit should trip to open
   */
  private shouldTrip(): boolean {
    // Need minimum volume
    if (this.totalCalls < this.config.volumeThreshold) {
      return false;
    }

    return this.failures >= this.config.failureThreshold;
  }

  /**
   * Trip the circuit to open state
   */
  private trip(): void {
    const oldState = this.state;
    this.state = 'OPEN';
    this.lastStateChange = Date.now();
    this.halfOpenCalls = 0;

    this.emit('trip', { stats: this.getStats() });
    this.notifyStateChange(oldState, 'OPEN');

    // Schedule reset to half-open
    this.scheduleReset();
  }

  /**
   * Close the circuit
   */
  private close(): void {
    const oldState = this.state;
    this.state = 'CLOSED';
    this.lastStateChange = Date.now();
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCalls = 0;

    this.emit('close', { stats: this.getStats() });
    this.notifyStateChange(oldState, 'CLOSED');
  }

  /**
   * Move to half-open state
   */
  private halfOpen(): void {
    const oldState = this.state;
    this.state = 'HALF_OPEN';
    this.lastStateChange = Date.now();
    this.halfOpenCalls = 0;

    this.emit('halfOpen', { stats: this.getStats() });
    this.notifyStateChange(oldState, 'HALF_OPEN');
  }

  /**
   * Schedule automatic reset to half-open
   */
  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      if (this.state === 'OPEN') {
        this.halfOpen();
      }
    }, this.config.resetTimeout);
  }

  /**
   * Notify state change callback
   */
  private notifyStateChange(oldState: CircuitState, newState: CircuitState): void {
    if (this.config.onStateChange) {
      this.config.onStateChange(oldState, newState);
    }
    this.emit('stateChange', { oldState, newState });
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      rejects: this.rejects,
      timeouts: this.timeouts,
      totalCalls: this.totalCalls,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      lastStateChange: this.lastStateChange,
    };
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  /**
   * Check if circuit is closed
   */
  isClosed(): boolean {
    return this.state === 'CLOSED';
  }

  /**
   * Check if circuit is half-open
   */
  isHalfOpen(): boolean {
    return this.state === 'HALF_OPEN';
  }

  /**
   * Manually trip the circuit
   */
  manualTrip(): void {
    this.trip();
  }

  /**
   * Manually reset the circuit
   */
  manualReset(): void {
    this.close();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.failures = 0;
    this.successes = 0;
    this.rejects = 0;
    this.timeouts = 0;
    this.totalCalls = 0;
    this.lastFailure = undefined;
    this.lastSuccess = undefined;
  }

  /**
   * Disable the circuit breaker (always closed)
   */
  disable(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }
}

// ============================================================================
// Errors
// ============================================================================

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public stats: CircuitBreakerStats
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreakerTimeoutError extends Error {
  constructor(
    message: string,
    public timeout: number
  ) {
    super(message);
    this.name = 'CircuitBreakerTimeoutError';
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCircuitBreaker(config: Partial<CircuitBreakerConfig> = {}): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: config.failureThreshold ?? 5,
    successThreshold: config.successThreshold ?? 3,
    timeout: config.timeout ?? 30000,
    resetTimeout: config.resetTimeout ?? 60000,
    volumeThreshold: config.volumeThreshold ?? 10,
    errorFilter: config.errorFilter,
    onStateChange: config.onStateChange,
    fallback: config.fallback,
  });
}

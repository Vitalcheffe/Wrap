/**
 * WRAP NEBULA v2.0 - Telemetry
 * OpenTelemetry integration for observability
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import {
  TelemetryInterface,
  TelemetryConfig,
  TelemetrySpan,
  SpanOptions,
  SpanKind,
  SpanStatus,
  SpanEvent,
  SpanLink,
  LogLevel,
} from '../types';

// ============================================================================
// Types
// ============================================================================

interface MetricRecord {
  name: string;
  value: number;
  timestamp: number;
  attributes: Record<string, unknown>;
}

interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: number;
  attributes: Record<string, unknown>;
}

interface TraceExporter {
  export(spans: TelemetrySpan[]): Promise<void>;
}

interface MetricExporter {
  export(metrics: MetricRecord[]): Promise<void>;
}

// ============================================================================
// Telemetry Implementation
// ============================================================================

export class Telemetry extends EventEmitter implements TelemetryInterface {
  private config: TelemetryConfig;
  private spans: Map<string, TelemetrySpanImpl> = new Map();
  private metrics: MetricRecord[] = [];
  private logs: LogRecord[] = [];
  private active: boolean = false;
  private exportInterval: NodeJS.Timeout | null = null;
  private traceExporter: TraceExporter | null = null;
  private metricExporter: MetricExporter | null = null;

  constructor(config: Partial<TelemetryConfig> = {}) {
    super();
    this.config = {
      enabled: true,
      serviceName: 'wrap-nebula',
      samplingRate: 1.0,
      exportInterval: 60000,
      attributes: {},
      ...config,
    };
  }

  /**
   * Initialize telemetry
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    this.active = true;

    // Start export interval
    if (this.config.exportInterval > 0) {
      this.exportInterval = setInterval(() => {
        this.exportData();
      }, this.config.exportInterval);
    }

    // Setup exporters
    if (this.config.endpoint) {
      this.traceExporter = new OTLPTraceExporter(this.config.endpoint);
      this.metricExporter = new OTLPMetricExporter(this.config.endpoint);
    }
  }

  /**
   * Shutdown telemetry
   */
  async shutdown(): Promise<void> {
    if (!this.active) return;

    // Stop export interval
    if (this.exportInterval) {
      clearInterval(this.exportInterval);
      this.exportInterval = null;
    }

    // Final export
    await this.exportData();

    this.active = false;
  }

  /**
   * Start a new span
   */
  startSpan(name: string, options: Partial<SpanOptions> = {}): TelemetrySpan {
    if (!this.config.enabled || Math.random() > this.config.samplingRate) {
      return new NoOpSpan();
    }

    const spanId = crypto.randomBytes(8).toString('hex');
    const traceId = options.parent?.traceId || crypto.randomBytes(16).toString('hex');

    const span = new TelemetrySpanImpl(
      spanId,
      traceId,
      name,
      options.kind || 'internal',
      options.attributes || {},
      options.parent,
      options.links
    );

    this.spans.set(spanId, span);

    // Add service attributes
    span.setAttribute('service.name', this.config.serviceName);
    for (const [key, value] of Object.entries(this.config.attributes)) {
      span.setAttribute(key, value);
    }

    return span;
  }

  /**
   * Record a metric
   */
  recordMetric(name: string, value: number, attributes: Record<string, unknown> = {}): void {
    if (!this.config.enabled) return;

    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      attributes,
    });

    this.emit('metric', { name, value, attributes });
  }

  /**
   * Log a message
   */
  log(level: LogLevel, message: string, attributes: Record<string, unknown> = {}): void {
    if (!this.config.enabled) return;

    this.logs.push({
      level,
      message,
      timestamp: Date.now(),
      attributes,
    });

    this.emit('log', { level, message, attributes });

    // Also console output
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch (level) {
      case 'error':
      case 'fatal':
        console.error(prefix, message, attributes);
        break;
      case 'warn':
        console.warn(prefix, message, attributes);
        break;
      default:
        console.log(prefix, message, attributes);
    }
  }

  /**
   * Export data to backend
   */
  private async exportData(): Promise<void> {
    // Export completed spans
    const completedSpans = Array.from(this.spans.values())
      .filter(span => span.endTime !== undefined);

    if (completedSpans.length > 0 && this.traceExporter) {
      await this.traceExporter.export(completedSpans);
    }

    // Export metrics
    if (this.metrics.length > 0 && this.metricExporter) {
      await this.metricExporter.export(this.metrics);
    }

    // Clear exported data
    for (const span of completedSpans) {
      this.spans.delete(span.spanId);
    }
    this.metrics = [];

    // Keep only recent logs
    const logLimit = 10000;
    if (this.logs.length > logLimit) {
      this.logs = this.logs.slice(-logLimit);
    }
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  trace(name: string): TelemetrySpan {
    return this.startSpan(name, { kind: 'internal' });
  }

  traceClient(name: string): TelemetrySpan {
    return this.startSpan(name, { kind: 'client' });
  }

  traceServer(name: string): TelemetrySpan {
    return this.startSpan(name, { kind: 'server' });
  }

  debug(message: string, attributes: Record<string, unknown> = {}): void {
    this.log('debug', message, attributes);
  }

  info(message: string, attributes: Record<string, unknown> = {}): void {
    this.log('info', message, attributes);
  }

  warn(message: string, attributes: Record<string, unknown> = {}): void {
    this.log('warn', message, attributes);
  }

  error(message: string, attributes: Record<string, unknown> = {}): void {
    this.log('error', message, attributes);
  }

  /**
   * Get spans
   */
  getSpans(): TelemetrySpanImpl[] {
    return Array.from(this.spans.values());
  }

  /**
   * Get metrics
   */
  getMetrics(): MetricRecord[] {
    return [...this.metrics];
  }

  /**
   * Get logs
   */
  getLogs(): LogRecord[] {
    return [...this.logs];
  }

  /**
   * Record API request
   */
  recordRequest(request: unknown, response: unknown, duration: number): void {
    this.recordMetric('http.request.duration', duration, {
      method: (request as Record<string, unknown>)?.method as string,
      status: (response as Record<string, unknown>)?.status as number,
    });

    this.recordMetric('http.request.count', 1, {
      method: (request as Record<string, unknown>)?.method as string,
    });
  }
}

// ============================================================================
// Telemetry Span Implementation
// ============================================================================

class TelemetrySpanImpl implements TelemetrySpan {
  spanId: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: SpanStatus;
  kind: SpanKind;
  parentSpanId?: string;
  links: SpanLink[];

  constructor(
    spanId: string,
    traceId: string,
    name: string,
    kind: SpanKind,
    attributes: Record<string, unknown>,
    parent?: TelemetrySpan,
    links?: SpanLink[]
  ) {
    this.spanId = spanId;
    this.traceId = traceId;
    this.name = name;
    this.startTime = Date.now();
    this.kind = kind;
    this.attributes = { ...attributes };
    this.events = [];
    this.status = { code: 'unset' };
    this.parentSpanId = parent?.spanId;
    this.links = links || [];
  }

  end(): void {
    this.endTime = Date.now();
  }

  addEvent(name: string, attributes: Record<string, unknown> = {}): void {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  setStatus(status: SpanStatus): void {
    this.status = status;
  }

  recordException(error: Error): void {
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    });
    this.status = { code: 'error', message: error.message };
  }

  getDuration(): number {
    return (this.endTime || Date.now()) - this.startTime;
  }
}

// ============================================================================
// No-Op Span (for disabled telemetry)
// ============================================================================

class NoOpSpan implements TelemetrySpan {
  spanId = '';
  traceId = '';
  name = '';
  startTime = 0;
  endTime?: number;
  attributes: Record<string, unknown> = {};
  events: SpanEvent[] = [];
  status: SpanStatus = { code: 'unset' };

  end(): void {}
  addEvent(): void {}
  setAttribute(): void {}
  setStatus(): void {}
  recordException(): void {}
}

// ============================================================================
// OTLP Exporters (Stub)
// ============================================================================

class OTLPTraceExporter implements TraceExporter {
  constructor(private endpoint: string) {}

  async export(spans: TelemetrySpan[]): Promise<void> {
    // In production, this would send spans to the OTLP endpoint
    // For now, we just log them
    const traceData = spans.map(span => ({
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      startTime: span.startTime,
      endTime: span.endTime,
      duration: (span as TelemetrySpanImpl).getDuration?.() || 0,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    }));

    // Could POST to endpoint here
  }
}

class OTLPMetricExporter implements MetricExporter {
  constructor(private endpoint: string) {}

  async export(metrics: MetricRecord[]): Promise<void> {
    // In production, this would send metrics to the OTLP endpoint
    // For now, we just log them
    const metricData = metrics.map(m => ({
      name: m.name,
      value: m.value,
      timestamp: m.timestamp,
      attributes: m.attributes,
    }));

    // Could POST to endpoint here
  }
}

// ============================================================================
// Exports
// ============================================================================

export { TelemetrySpanImpl };

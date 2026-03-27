/**
 * WRAP NEBULA v2.0 - Input Sanitizer
 * Input sanitization before sending to Core Engine
 */

import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export enum DetectionType {
  PROMPT_INJECTION = 'prompt_injection',
  PII_EMAIL = 'pii_email',
  PII_PHONE = 'pii_phone',
  PII_SSN = 'pii_ssn',
  PII_CREDIT_CARD = 'pii_credit_card',
  PII_ADDRESS = 'pii_address',
  PROFANITY = 'profanity',
  MALICIOUS_CODE = 'malicious_code',
  SENSITIVE_KEYWORD = 'sensitive_keyword',
}

export enum Severity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface DetectionResult {
  type: DetectionType;
  pattern: string;
  match: string;
  position: { start: number; end: number };
  severity: Severity;
}

export interface SanitizationResult {
  original: string;
  sanitized: string | null;
  rejected: boolean;
  reason?: string;
  detections: DetectionResult[];
  modified: boolean;
}

export interface SanitizerConfig {
  enablePromptInjection?: boolean;
  enablePIIDetection?: boolean;
  enableProfanityFilter?: boolean;
  enableSensitiveKeywords?: boolean;
  rejectThreshold?: Severity;
  maskPII?: boolean;
  maskChar?: string;
}

// ============================================================================
// Input Sanitizer
// ============================================================================

export class InputSanitizer {
  private config: Required<SanitizerConfig>;
  private patterns: Map<DetectionType, { pattern: RegExp; severity: Severity }> = new Map();

  constructor(config: SanitizerConfig = {}) {
    this.config = {
      enablePromptInjection: config.enablePromptInjection ?? true,
      enablePIIDetection: config.enablePIIDetection ?? true,
      enableProfanityFilter: config.enableProfanityFilter ?? true,
      enableSensitiveKeywords: config.enableSensitiveKeywords ?? true,
      rejectThreshold: config.rejectThreshold ?? Severity.HIGH,
      maskPII: config.maskPII ?? true,
      maskChar: config.maskChar ?? '*',
    };

    this.initializePatterns();
  }

  private initializePatterns(): void {
    // Prompt injection
    if (this.config.enablePromptInjection) {
      this.patterns.set(DetectionType.PROMPT_INJECTION, {
        pattern: /(?:ignore\s+(?:all\s+)?(?:previous|above)\s+instructions?|system:\s*you\s+are|disregard\s+(?:all\s+)?(?:previous|above)|forget\s+(?:(?:all|everything)\s+)*(?:previous|above)|override\s+(?:all\s+)?(?:previous|above)|new\s+instructions?:|your\s+new\s+(?:role|task|instructions?)|act\s+as\s+(?:if\s+you\s+are|a|an)|pretend\s+(?:to\s+be|you\s+are)|simulate\s+(?:being|a|an)|roleplay\s+(?:as|that)|you\s+must\s+(?:now|always|forget)|\<\|im_start\|\>|\<\|im_end\|\>)/gi,
        severity: Severity.CRITICAL,
      });
    }

    // PII patterns
    if (this.config.enablePIIDetection) {
      this.patterns.set(DetectionType.PII_EMAIL, {
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        severity: Severity.MEDIUM,
      });

      this.patterns.set(DetectionType.PII_PHONE, {
        pattern: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
        severity: Severity.MEDIUM,
      });

      this.patterns.set(DetectionType.PII_SSN, {
        pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
        severity: Severity.HIGH,
      });

      this.patterns.set(DetectionType.PII_CREDIT_CARD, {
        pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
        severity: Severity.CRITICAL,
      });

      this.patterns.set(DetectionType.PII_ADDRESS, {
        pattern: /\d+\s+[a-zA-Z\s]+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd)\.?(?:\s+[a-zA-Z\s]+)?/gi,
        severity: Severity.MEDIUM,
      });
    }

    // Profanity
    if (this.config.enableProfanityFilter) {
      this.patterns.set(DetectionType.PROFANITY, {
        pattern: /\b(?:fuck|shit|damn|ass|bitch|bastard|crap|dick|piss|whore|slut)\b/gi,
        severity: Severity.LOW,
      });
    }

    // Sensitive keywords
    if (this.config.enableSensitiveKeywords) {
      this.patterns.set(DetectionType.SENSITIVE_KEYWORD, {
        pattern: /\b(?:password|secret|api_key|apikey|token|auth|credential|private_key)\s*[=:]\s*\S+/gi,
        severity: Severity.CRITICAL,
      });
    }

    // Malicious code
    this.patterns.set(DetectionType.MALICIOUS_CODE, {
      pattern: /(?:eval\s*\(|Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]|document\.write|innerHTML\s*=|outerHTML\s*=)/g,
      severity: Severity.HIGH,
    });
  }

  sanitize(text: string): SanitizationResult {
    const detections: DetectionResult[] = [];
    let sanitized = text;
    let rejected = false;
    let reason: string | undefined;

    // Run all pattern detections
    for (const [type, config] of this.patterns) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(config.pattern.source, config.pattern.flags);

      while ((match = regex.exec(text)) !== null) {
        detections.push({
          type,
          pattern: config.pattern.source,
          match: match[0],
          position: { start: match.index, end: match.index + match[0].length },
          severity: config.severity,
        });
      }
    }

    // Check for rejections
    const severityOrder = [Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL];
    const thresholdIndex = severityOrder.indexOf(this.config.rejectThreshold);

    for (const detection of detections) {
      const detectionIndex = severityOrder.indexOf(detection.severity);

      if (detectionIndex >= thresholdIndex) {
        rejected = true;
        reason = `Detected ${detection.type} with severity ${detection.severity}`;
        break;
      }
    }

    // Mask PII if enabled
    if (this.config.maskPII && !rejected) {
      for (const detection of detections) {
        if (detection.type.toString().startsWith('pii_')) {
          sanitized = this.maskText(sanitized, detection);
        }
      }
    }

    return {
      original: text,
      sanitized: rejected ? null : sanitized,
      rejected,
      reason,
      detections,
      modified: sanitized !== text,
    };
  }

  private maskText(text: string, detection: DetectionResult): string {
    const before = text.slice(0, detection.position.start);
    const after = text.slice(detection.position.end);
    const masked = this.config.maskChar.repeat(detection.match.length);
    return before + masked + after;
  }

  isSafe(text: string): boolean {
    return !this.sanitize(text).rejected;
  }

  detectPII(text: string): DetectionResult[] {
    return this.sanitize(text).detections.filter(d =>
      d.type.toString().startsWith('pii_')
    );
  }

  detectPromptInjection(text: string): DetectionResult[] {
    return this.sanitize(text).detections.filter(d =>
      d.type === DetectionType.PROMPT_INJECTION
    );
  }

  static hashInput(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function sanitize(text: string, config?: SanitizerConfig): SanitizationResult {
  const sanitizer = new InputSanitizer(config);
  return sanitizer.sanitize(text);
}

export function isSafe(text: string, config?: SanitizerConfig): boolean {
  const sanitizer = new InputSanitizer(config);
  return sanitizer.isSafe(text);
}

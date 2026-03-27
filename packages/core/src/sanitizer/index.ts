/**
 * WRAP NEBULA v2.0 - Input Sanitizer
 * Input sanitization BEFORE LLM call (SDK level)
 */

import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface SanitizationResult {
  original: string;
  sanitized: string | null;
  rejected: boolean;
  reason?: string;
  detections: DetectionResult[];
  modified: boolean;
}

export interface DetectionResult {
  type: DetectionType;
  pattern: string;
  match: string;
  position: { start: number; end: number };
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export type DetectionType = 
  | 'prompt_injection'
  | 'pii_email'
  | 'pii_phone'
  | 'pii_ssn'
  | 'pii_credit_card'
  | 'pii_address'
  | 'profanity'
  | 'malicious_code'
  | 'sensitive_keyword';

export interface SanitizerConfig {
  enablePromptInjection: boolean;
  enablePIIDetection: boolean;
  enableProfanityFilter: boolean;
  enableSensitiveKeywords: boolean;
  rejectThreshold: 'low' | 'medium' | 'high' | 'critical';
  maskPII: boolean;
  maskChar: string;
  customPatterns: Array<{
    name: string;
    pattern: RegExp;
    type: DetectionType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    action: 'reject' | 'mask' | 'warn';
  }>;
}

// ============================================================================
// Input Sanitizer Implementation
// ============================================================================

export class InputSanitizer {
  private config: SanitizerConfig;
  private patterns: Map<DetectionType, { pattern: RegExp; severity: 'low' | 'medium' | 'high' | 'critical' }>;

  constructor(config: Partial<SanitizerConfig> = {}) {
    this.config = {
      enablePromptInjection: true,
      enablePIIDetection: true,
      enableProfanityFilter: true,
      enableSensitiveKeywords: true,
      rejectThreshold: 'high',
      maskPII: true,
      maskChar: '*',
      customPatterns: [],
      ...config,
    };

    this.patterns = new Map();
    this.initializePatterns();
  }

  /**
   * Initialize detection patterns
   */
  private initializePatterns(): void {
    // Prompt injection patterns
    if (this.config.enablePromptInjection) {
      this.patterns.set('prompt_injection', {
        pattern: /(?:ignore\s+(?:all\s+)?(?:previous|above)\s+instructions?|system:\s*you\s+are|disregard\s+(?:all\s+)?(?:previous|above)|forget\s+(?:(?:all|everything)\s+)*(?:previous|above)|override\s+(?:all\s+)?(?:previous|above)|new\s+instructions?:|your\s+new\s+(?:role|task|instructions?)|act\s+as\s+(?:if\s+you\s+are|a|an)|pretend\s+(?:to\s+be|you\s+are)|simulate\s+(?:being|a|an)|roleplay\s+(?:as|that)|you\s+must\s+(?:now|always|forget)|\<\|im_start\|\>|\<\|im_end\|\>)/gi,
        severity: 'critical',
      });
    }

    // PII patterns
    if (this.config.enablePIIDetection) {
      // Email
      this.patterns.set('pii_email', {
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        severity: 'medium',
      });

      // Phone number (various formats)
      this.patterns.set('pii_phone', {
        pattern: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
        severity: 'medium',
      });

      // SSN
      this.patterns.set('pii_ssn', {
        pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
        severity: 'high',
      });

      // Credit card
      this.patterns.set('pii_credit_card', {
        pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
        severity: 'critical',
      });

      // Address (basic)
      this.patterns.set('pii_address', {
        pattern: /\d+\s+[a-zA-Z\s]+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd)\.?(?:\s+[a-zA-Z\s]+)?/gi,
        severity: 'medium',
      });
    }

    // Profanity patterns (basic list - in production use comprehensive filter)
    if (this.config.enableProfanityFilter) {
      this.patterns.set('profanity', {
        pattern: /\b(?:fuck|shit|damn|ass|bitch|bastard|crap|dick|piss|whore|slut)\b/gi,
        severity: 'low',
      });
    }

    // Sensitive keywords
    if (this.config.enableSensitiveKeywords) {
      this.patterns.set('sensitive_keyword', {
        pattern: /\b(?:password|secret|api_key|apikey|token|auth|credential|private_key)\s*[=:]\s*\S+/gi,
        severity: 'critical',
      });
    }

    // Malicious code patterns
    this.patterns.set('malicious_code', {
      pattern: /(?:eval\s*\(|Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]|document\.write|innerHTML\s*=|outerHTML\s*=)/g,
      severity: 'high',
    });
  }

  /**
   * Sanitize input text
   */
  sanitize(input: string): SanitizationResult {
    const detections: DetectionResult[] = [];
    let sanitized = input;
    let rejected = false;
    let reason: string | undefined;

    // Run all pattern detections
    for (const [type, config] of this.patterns) {
      const matches = this.findMatches(input, config.pattern, type, config.severity);
      detections.push(...matches);
    }

    // Add custom patterns
    for (const custom of this.config.customPatterns) {
      const matches = this.findMatches(input, custom.pattern, custom.type, custom.severity);
      detections.push(...matches);
    }

    // Check for rejections based on threshold
    const severityOrder = ['low', 'medium', 'high', 'critical'];
    const thresholdIndex = severityOrder.indexOf(this.config.rejectThreshold);

    for (const detection of detections) {
      const detectionIndex = severityOrder.indexOf(detection.severity);
      
      if (detectionIndex >= thresholdIndex) {
        rejected = true;
        reason = `Detected ${detection.type} with severity ${detection.severity}`;
        break;
      }
    }

    // Apply masking for PII if enabled
    if (this.config.maskPII && !rejected) {
      for (const detection of detections) {
        if (detection.type.startsWith('pii_')) {
          sanitized = this.maskText(sanitized, detection);
        }
      }
    }

    return {
      original: input,
      sanitized: rejected ? null : sanitized,
      rejected,
      reason,
      detections,
      modified: sanitized !== input,
    };
  }

  /**
   * Find all matches for a pattern
   */
  private findMatches(
    text: string,
    pattern: RegExp,
    type: DetectionType,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): DetectionResult[] {
    const results: DetectionResult[] = [];
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      results.push({
        type,
        pattern: pattern.source,
        match: match[0],
        position: { start: match.index, end: match.index + match[0].length },
        severity,
      });
    }

    return results;
  }

  /**
   * Mask detected text
   */
  private maskText(text: string, detection: DetectionResult): string {
    const before = text.slice(0, detection.position.start);
    const after = text.slice(detection.position.end);
    const masked = this.config.maskChar.repeat(detection.match.length);
    return before + masked + after;
  }

  // ==========================================================================
  // Additional Methods
  // ==========================================================================

  /**
   * Check if input is safe
   */
  isSafe(input: string): boolean {
    const result = this.sanitize(input);
    return !result.rejected;
  }

  /**
   * Detect PII only
   */
  detectPII(input: string): DetectionResult[] {
    const result = this.sanitize(input);
    return result.detections.filter(d => d.type.startsWith('pii_'));
  }

  /**
   * Detect prompt injection only
   */
  detectPromptInjection(input: string): DetectionResult[] {
    const result = this.sanitize(input);
    return result.detections.filter(d => d.type === 'prompt_injection');
  }

  /**
   * Add custom pattern
   */
  addCustomPattern(pattern: {
    name: string;
    pattern: RegExp;
    type: DetectionType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    action: 'reject' | 'mask' | 'warn';
  }): void {
    this.config.customPatterns.push(pattern);
  }

  /**
   * Remove custom pattern
   */
  removeCustomPattern(name: string): boolean {
    const index = this.config.customPatterns.findIndex(p => p.name === name);
    if (index >= 0) {
      this.config.customPatterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all detections for input
   */
  getAllDetections(input: string): DetectionResult[] {
    const result = this.sanitize(input);
    return result.detections;
  }

  /**
   * Calculate hash of input
   */
  hashInput(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick sanitize function
 */
export function sanitize(input: string, config?: Partial<SanitizerConfig>): SanitizationResult {
  const sanitizer = new InputSanitizer(config);
  return sanitizer.sanitize(input);
}

/**
 * Quick check if input is safe
 */
export function isSafe(input: string, config?: Partial<SanitizerConfig>): boolean {
  const sanitizer = new InputSanitizer(config);
  return sanitizer.isSafe(input);
}

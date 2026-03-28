//! Content filters for the Safety Governor

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Detection result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionResult {
    /// Detection type
    pub detection_type: String,
    /// Matched pattern
    pub pattern: String,
    /// Matched text
    pub matched: String,
    /// Severity level
    pub severity: Severity,
}

/// Severity levels
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

/// Filter chain for content scanning
pub struct FilterChain {
    /// Injection patterns
    injection_patterns: Vec<(Regex, Severity)>,
    /// Profanity patterns
    profanity_patterns: Vec<(Regex, Severity)>,
}

impl Default for FilterChain {
    fn default() -> Self {
        Self {
            injection_patterns: Self::default_injection_patterns(),
            profanity_patterns: Self::default_profanity_patterns(),
        }
    }
}

impl FilterChain {
    /// Scan content for issues
    pub fn scan(&self, content: &str) -> Option<String> {
        // Check injection patterns
        for (pattern, severity) in &self.injection_patterns {
            if pattern.is_match(content) {
                return Some(format!(
                    "Injection detected (severity: {:?}): {}",
                    severity,
                    pattern.as_str()
                ));
            }
        }

        // Check profanity patterns
        for (pattern, severity) in &self.profanity_patterns {
            if pattern.is_match(content) {
                return Some(format!(
                    "Profanity detected (severity: {:?}): {}",
                    severity,
                    pattern.as_str()
                ));
            }
        }

        None
    }

    /// Get all detections
    pub fn get_all_detections(&self, content: &str) -> Vec<DetectionResult> {
        let mut results = Vec::new();

        for (pattern, severity) in &self.injection_patterns {
            for m in pattern.find_iter(content) {
                results.push(DetectionResult {
                    detection_type: "injection".to_string(),
                    pattern: pattern.as_str().to_string(),
                    matched: m.as_str().to_string(),
                    severity: *severity,
                });
            }
        }

        for (pattern, severity) in &self.profanity_patterns {
            for m in pattern.find_iter(content) {
                results.push(DetectionResult {
                    detection_type: "profanity".to_string(),
                    pattern: pattern.as_str().to_string(),
                    matched: m.as_str().to_string(),
                    severity: *severity,
                });
            }
        }

        results
    }

    fn default_injection_patterns() -> Vec<(Regex, Severity)> {
        let patterns: Vec<(&str, Severity)> = vec![
            // Prompt injection
            (r"(?i)ignore\s+(?:all\s+)?(?:previous|above)\s+instructions?", Severity::Critical),
            (r"(?i)system:\s*you\s+are", Severity::Critical),
            (r"(?i)disregard\s+(?:all\s+)?(?:previous|above)", Severity::Critical),
            (r"(?i)forget\s+(?:all\s+)?(?:previous|above)", Severity::Critical),
            (r"(?i)override\s+(?:all\s+)?(?:previous|above)", Severity::Critical),
            (r"(?i)new\s+instructions?", Severity::High),
            (r"(?i)your\s+new\s+(?:role|task|instructions?)", Severity::High),
            (r"(?i)act\s+as\s+(?:if\s+you\s+are|a|an)", Severity::Medium),
            (r"(?i)pretend\s+(?:to\s+be|you\s+are)", Severity::Medium),
            (r"(?i)simulate\s+(?:being|a|an)", Severity::Medium),
            (r"(?i)roleplay\s+(?:as|that)", Severity::Medium),
            // Code injection
            (r"(?i)eval\s*\(", Severity::Critical),
            (r"(?i)Function\s*\(", Severity::Critical),
            (r"(?i)document\.write", Severity::High),
            (r"(?i)innerHTML\s*=", Severity::High),
            // SQL injection
            (r"(?i)(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\s+", Severity::Critical),
            (r"(?i)';?\s*(?:DROP|DELETE|UPDATE|INSERT)", Severity::Critical),
            (r"(?i)--\s*$", Severity::High),
            (r"(?i)/\*.*\*/", Severity::Medium),
            // XSS
            (r"(?i)<script[^>]*>", Severity::Critical),
            (r"(?i)javascript:", Severity::High),
            (r"(?i)on(?:load|error|click|mouseover)\s*=", Severity::High),
        ];

        patterns
            .into_iter()
            .filter_map(|(p, s)| Regex::new(p).ok().map(|r| (r, s)))
            .collect()
    }

    fn default_profanity_patterns() -> Vec<(Regex, Severity)> {
        let patterns: Vec<(&str, Severity)> = vec![
            (r"(?i)\bfuck\b", Severity::Low),
            (r"(?i)\bshit\b", Severity::Low),
            (r"(?i)\bdamn\b", Severity::Low),
            (r"(?i)\bbitch\b", Severity::Low),
        ];

        patterns
            .into_iter()
            .filter_map(|(p, s)| Regex::new(p).ok().map(|r| (r, s)))
            .collect()
    }
}

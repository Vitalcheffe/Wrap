//! Content filtering for safety

use std::collections::HashSet;
use regex::Regex;
use serde::{Deserialize, Serialize};

/// Result of content filtering
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterResult {
    pub allowed: bool,
    pub categories: Vec<FilterCategory>,
    pub confidence: f32,
    pub issues: Vec<FilterIssue>,
    pub redacted: Option<String>,
}

impl FilterResult {
    pub fn allowed() -> Self {
        Self {
            allowed: true,
            categories: vec![],
            confidence: 1.0,
            issues: vec![],
            redacted: None,
        }
    }

    pub fn denied(category: FilterCategory, reason: &str) -> Self {
        Self {
            allowed: false,
            categories: vec![category],
            confidence: 1.0,
            issues: vec![FilterIssue {
                category: FilterCategory::Profanity,
                description: reason.to_string(),
                severity: Severity::High,
            }],
            redacted: None,
        }
    }
}

/// Category of content filter
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FilterCategory {
    Profanity,
    PII,
    Injection,
    Malicious,
    Sensitive,
}

/// A specific filter issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterIssue {
    pub category: FilterCategory,
    pub description: String,
    pub severity: Severity,
}

/// Severity level
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

/// Trait for content filters
pub trait ContentFilter: Send + Sync {
    fn check(&self, content: &str) -> Result<FilterResult, FilterError>;
    fn category(&self) -> FilterCategory;
    fn name(&self) -> &str;
}

/// Filter error
#[derive(Debug, thiserror::Error)]
pub enum FilterError {
    #[error("Regex error: {0}")]
    Regex(#[from] regex::Error),
    #[error("Filter error: {0}")]
    Other(String),
}

/// Profanity filter
pub struct ProfanityFilter {
    words: HashSet<String>,
}

impl ProfanityFilter {
    pub fn new() -> Self {
        let words: HashSet<String> = vec![
            "damn", "hell", "ass", "crap", "bastard",
            "shit", "fuck", "bitch", "dick", "piss",
        ].into_iter().map(|s| s.to_lowercase()).collect();
        Self { words }
    }

    fn normalize(&self, text: &str) -> String {
        text.chars()
            .map(|c| match c.to_ascii_lowercase() {
                '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's',
                '7' => 't', '0' => 'o', '@' => 'a', '$' => 's',
                _ => c.to_ascii_lowercase(),
            })
            .collect()
    }
}

impl ContentFilter for ProfanityFilter {
    fn check(&self, content: &str) -> Result<FilterResult, FilterError> {
        let normalized = self.normalize(content);
        let lower = content.to_lowercase();

        let mut issues: Vec<FilterIssue> = vec![];

        for word in &self.words {
            if normalized.contains(word) || lower.contains(word) {
                issues.push(FilterIssue {
                    category: FilterCategory::Profanity,
                    description: format!("Profanity detected: {}", word),
                    severity: Severity::Medium,
                });
            }
        }

        if issues.is_empty() {
            Ok(FilterResult::allowed())
        } else {
            Ok(FilterResult {
                allowed: false,
                categories: vec![FilterCategory::Profanity],
                confidence: 0.9,
                issues,
                redacted: None,
            })
        }
    }

    fn category(&self) -> FilterCategory { FilterCategory::Profanity }
    fn name(&self) -> &str { "ProfanityFilter" }
}

impl Default for ProfanityFilter {
    fn default() -> Self { Self::new() }
}

/// PII filter
pub struct PIIFilter {
    email_regex: Regex,
    phone_regex: Regex,
    ssn_regex: Regex,
    credit_card_regex: Regex,
}

impl PIIFilter {
    pub fn new() -> Self {
        Self {
            email_regex: Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap(),
            phone_regex: Regex::new(r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b").unwrap(),
            ssn_regex: Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap(),
            credit_card_regex: Regex::new(r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b").unwrap(),
        }
    }
}

impl ContentFilter for PIIFilter {
    fn check(&self, content: &str) -> Result<FilterResult, FilterError> {
        let mut issues: Vec<FilterIssue> = vec![];
        let mut redacted = content.to_string();

        if self.email_regex.is_match(content) {
            issues.push(FilterIssue {
                category: FilterCategory::PII,
                description: "Email address detected".to_string(),
                severity: Severity::High,
            });
            redacted = self.email_regex.replace_all(&redacted, "[EMAIL REDACTED]").to_string();
        }

        if self.phone_regex.is_match(content) {
            issues.push(FilterIssue {
                category: FilterCategory::PII,
                description: "Phone number detected".to_string(),
                severity: Severity::Medium,
            });
            redacted = self.phone_regex.replace_all(&redacted, "[PHONE REDACTED]").to_string();
        }

        if self.ssn_regex.is_match(content) {
            issues.push(FilterIssue {
                category: FilterCategory::PII,
                description: "SSN detected".to_string(),
                severity: Severity::Critical,
            });
            redacted = self.ssn_regex.replace_all(&redacted, "[SSN REDACTED]").to_string();
        }

        if self.credit_card_regex.is_match(content) {
            issues.push(FilterIssue {
                category: FilterCategory::PII,
                description: "Credit card detected".to_string(),
                severity: Severity::Critical,
            });
            redacted = self.credit_card_regex.replace_all(&redacted, "[CARD REDACTED]").to_string();
        }

        if issues.is_empty() {
            Ok(FilterResult::allowed())
        } else {
            Ok(FilterResult {
                allowed: false,
                categories: vec![FilterCategory::PII],
                confidence: 0.95,
                issues,
                redacted: Some(redacted),
            })
        }
    }

    fn category(&self) -> FilterCategory { FilterCategory::PII }
    fn name(&self) -> &str { "PIIFilter" }
}

impl Default for PIIFilter {
    fn default() -> Self { Self::new() }
}

/// Injection filter
pub struct InjectionFilter {
    patterns: Vec<(Regex, &'static str, Severity)>,
}

impl InjectionFilter {
    pub fn new() -> Self {
        let patterns = vec![
            (Regex::new(r"(?i)(union\s+select|select\s+.*\s+from|insert\s+into|delete\s+from|drop\s+table)").unwrap(), "SQL Injection", Severity::Critical),
            (Regex::new(r"(?i)(<script|javascript:|on\w+\s*=|eval\s*\()").unwrap(), "XSS", Severity::Critical),
            (Regex::new(r"(;|\||`|\$\().*(ls|cat|rm|wget|curl|bash|sh|python)").unwrap(), "Command Injection", Severity::Critical),
            (Regex::new(r"(\.\.\/|\.\.\\|%2e%2e)").unwrap(), "Path Traversal", Severity::High),
            (Regex::new(r"(?i)(ignore\s+(previous|all)\s+(instructions?|prompts?))").unwrap(), "Prompt Injection", Severity::High),
        ];
        Self { patterns }
    }
}

impl ContentFilter for InjectionFilter {
    fn check(&self, content: &str) -> Result<FilterResult, FilterError> {
        let mut issues: Vec<FilterIssue> = vec![];

        for (regex, name, severity) in &self.patterns {
            if regex.is_match(content) {
                issues.push(FilterIssue {
                    category: FilterCategory::Injection,
                    description: format!("{} detected", name),
                    severity: *severity,
                });
            }
        }

        if issues.is_empty() {
            Ok(FilterResult::allowed())
        } else {
            Ok(FilterResult {
                allowed: false,
                categories: vec![FilterCategory::Injection],
                confidence: 0.85,
                issues,
                redacted: None,
            })
        }
    }

    fn category(&self) -> FilterCategory { FilterCategory::Injection }
    fn name(&self) -> &str { "InjectionFilter" }
}

impl Default for InjectionFilter {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profanity_filter() {
        let filter = ProfanityFilter::new();
        let result = filter.check("Hello, world!").unwrap();
        assert!(result.allowed);

        let result = filter.check("This is damn bad").unwrap();
        assert!(!result.allowed);
    }

    #[test]
    fn test_pii_filter() {
        let filter = PIIFilter::new();
        let result = filter.check("Contact me at test@example.com").unwrap();
        assert!(!result.allowed);
        assert!(result.redacted.is_some());
    }

    #[test]
    fn test_injection_filter() {
        let filter = InjectionFilter::new();
        let result = filter.check("SELECT * FROM users").unwrap();
        assert!(!result.allowed);
    }
}

//! Content filters for the Safety Governor

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
    injection_patterns: Vec<(regex::Regex, Severity)>,
    /// Profanity patterns
    profanity_patterns: Vec<(regex::Regex, Severity)>,
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
        
        results
    }
    
    fn default_injection_patterns() -> Vec<(regex::Regex, Severity)> {
        let patterns = vec![
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
        ];
        
        patterns
            .into_iter()
            .filter_map(|(p, s)| regex::Regex::new(p).ok().map(|r| (r, s)))
            .collect()
    }
    
    fn default_profanity_patterns() -> Vec<(regex::Regex, Severity)> {
        let patterns = vec![
            (r"(?i)\bfuck\b", Severity::Low),
            (r"(?i)\bshit\b", Severity::Low),
            (r"(?i)\bdamn\b", Severity::Low),
            (r"(?i)\bass\b", Severity::Low),
            (r"(?i)\bbitch\b", Severity::Low),
        ];
        
        patterns
            .into_iter()
            .filter_map(|(p, s)| regex::Regex::new(p).ok().map(|r| (r, s)))
            .collect()
    }
}

/// Minimal regex module stub
mod regex {
    use std::fmt;
    
    pub struct Regex {
        pattern: String,
    }
    
    impl Regex {
        pub fn new(pattern: &str) -> Result<Self, ()> {
            Ok(Self {
                pattern: pattern.to_string(),
            })
        }
        
        pub fn is_match(&self, text: &str) -> bool {
            // Simplified matching - in production use the regex crate
            let pattern_lower = self.pattern.to_lowercase()
                .replace("(?i)", "")
                .replace("\\b", "")
                .replace("\\s+", " ");
            
            text.to_lowercase().contains(&pattern_lower)
        }
        
        pub fn find_iter<'a>(&'a self, text: &'a str) -> impl Iterator<Item = Match<'a>> {
            // Simplified - just return one match if found
            if self.is_match(text) {
                Some(Match {
                    text,
                    start: 0,
                    end: text.len().min(50),
                }).into_iter()
            } else {
                None.into_iter().flatten()
            }
        }
        
        pub fn as_str(&self) -> &str {
            &self.pattern
        }
    }
    
    impl fmt::Debug for Regex {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "Regex({})", self.pattern)
        }
    }
    
    pub struct Match<'a> {
        text: &'a str,
        start: usize,
        end: usize,
    }
    
    impl<'a> Match<'a> {
        pub fn as_str(&self) -> &'a str {
            &self.text[self.start..self.end]
        }
    }
}

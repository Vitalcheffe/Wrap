//! Profanity filter for the Governor safety system.
//!
//! This module provides comprehensive profanity filtering with:
//! - Word list matching
//! - Normalization for obfuscation detection
//! - Context-aware severity
//! - Multi-language support

use crate::filters::{ContentFilter, FilterConfig, FilterMatch, FilterResult, ContentType, FilterAction, Severity};
use async_trait::async_trait;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

/// Configuration specific to the profanity filter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfanityConfig {
    /// Base filter configuration
    pub base: FilterConfig,
    /// Words to block (exact matches)
    pub blocked_words: HashSet<String>,
    /// Words to warn about
    pub warned_words: HashSet<String>,
    /// Regular expression patterns
    pub patterns: Vec<String>,
    /// Whether to check for obfuscated words
    pub detect_obfuscation: bool,
    /// Character substitutions to check
    pub substitution_map: HashMap<char, Vec<char>>,
    /// Minimum word length to check
    pub min_word_length: usize,
    /// Whether to check partial matches
    pub check_partial_matches: bool,
    /// Words that are exceptions (allowed even if similar to blocked)
    pub exceptions: HashSet<String>,
    /// Replacement string for redacted content
    pub replacement: String,
    /// Languages to check (ISO 639-1 codes)
    pub languages: Vec<String>,
}

impl Default for ProfanityConfig {
    fn default() -> Self {
        let mut blocked_words = HashSet::new();
        let mut warned_words = HashSet::new();

        // Default English blocked words (sample - in production would be extensive)
        let blocked = [
            "damn", "hell", "ass", "bastard", "bitch", "crap", "dick", "fuck",
            "piss", "shit", "whore", "slut", "cock", "pussy", "twat", "wanker",
            "bollocks", "bugger", "sod", "git", "prick", "knob", "bellend",
        ];

        let warned = [
            "hell", "damn", "crap", "suck", "sucks", "screwed", "screwing",
            "frick", "frig", "freaking", "freakin", "heck", "darn", "dang",
        ];

        for word in blocked {
            blocked_words.insert(word.to_lowercase());
        }
        for word in warned {
            warned_words.insert(word.to_lowercase());
        }

        // Common character substitutions used to bypass filters
        let mut substitution_map = HashMap::new();
        substitution_map.insert('a', vec!['@', '4', 'å', 'ä', 'â', 'à']);
        substitution_map.insert('e', vec!['3', 'ë', 'ê', 'è', 'é']);
        substitution_map.insert('i', vec!['1', '!', 'ï', 'î', 'ì']);
        substitution_map.insert('o', vec!['0', 'ö', 'ô', 'ò', 'ó']);
        substitution_map.insert('u', vec!['ü', 'û', 'ù', 'ú']);
        substitution_map.insert('s', vec!['$', '5', 'ß']);
        substitution_map.insert('t', vec!['7', '+']);
        substitution_map.insert('l', vec!['1', '|']);
        substitution_map.insert('c', vec!['(', '<']);
        substitution_map.insert('b', vec!['8']);
        substitution_map.insert('g', vec!['9']);
        substitution_map.insert('z', vec!['2']);

        Self {
            base: FilterConfig {
                enabled: true,
                min_severity: Severity::Info,
                default_action: FilterAction::Warn,
                max_content_length: 0,
                truncate_matches: true,
                max_match_length: 30,
                settings: HashMap::new(),
            },
            blocked_words,
            warned_words,
            patterns: Vec::new(),
            detect_obfuscation: true,
            substitution_map,
            min_word_length: 3,
            check_partial_matches: false,
            exceptions: HashSet::new(),
            replacement: "[REDACTED]".to_string(),
            languages: vec!["en".to_string()],
        }
    }
}

impl ProfanityConfig {
    /// Creates a new profanity configuration.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a blocked word.
    #[must_use]
    pub fn block_word(mut self, word: impl Into<String>) -> Self {
        self.blocked_words.insert(word.into().to_lowercase());
        self
    }

    /// Adds a warned word.
    #[must_use]
    pub fn warn_word(mut self, word: impl Into<String>) -> Self {
        self.warned_words.insert(word.into().to_lowercase());
        self
    }

    /// Adds an exception.
    #[must_use]
    pub fn add_exception(mut self, word: impl Into<String>) -> Self {
        self.exceptions.insert(word.into().to_lowercase());
        self
    }

    /// Sets the replacement string.
    #[must_use]
    pub fn with_replacement(mut self, replacement: impl Into<String>) -> Self {
        self.replacement = replacement.into();
        self
    }

    /// Checks if a word is blocked.
    #[must_use]
    pub fn is_blocked(&self, word: &str) -> bool {
        let lower = word.to_lowercase();
        self.blocked_words.contains(&lower) && !self.exceptions.contains(&lower)
    }

    /// Checks if a word is warned.
    #[must_use]
    pub fn is_warned(&self, word: &str) -> bool {
        let lower = word.to_lowercase();
        self.warned_words.contains(&lower) && !self.exceptions.contains(&lower)
    }
}

/// The profanity filter implementation.
pub struct ProfanityFilter {
    /// Configuration
    config: RwLock<ProfanityConfig>,
    /// Compiled word boundary regex
    word_regex: Regex,
    /// Normalization regex for obfuscation
    normalize_regex: Regex,
}

impl Default for ProfanityFilter {
    fn default() -> Self {
        Self::new(ProfanityConfig::default())
    }
}

impl ProfanityFilter {
    /// Creates a new profanity filter with the given configuration.
    #[must_use]
    pub fn new(config: ProfanityConfig) -> Self {
        // Word boundary regex - matches words and common separators
        let word_regex = Regex::new(r"(?i)([a-z][a-z'\-]*)")
            .expect("Failed to compile word regex");

        // Normalization regex - removes non-alphabetic characters
        let normalize_regex = Regex::new(r"[^a-zA-Z]")
            .expect("Failed to compile normalize regex");

        Self {
            config: RwLock::new(config),
            word_regex,
            normalize_regex,
        }
    }

    /// Creates a new profanity filter with default configuration.
    #[must_use]
    pub fn with_defaults() -> Self {
        Self::default()
    }

    /// Updates the configuration.
    pub fn update_config(&self, config: ProfanityConfig) {
        let mut current = self.config.write().expect("Lock poisoned");
        *current = config;
    }

    /// Gets the current configuration.
    #[must_use]
    pub fn get_config(&self) -> ProfanityConfig {
        self.config.read().expect("Lock poisoned").clone()
    }

    /// Normalizes a word by reversing common obfuscation techniques.
    #[must_use]
    pub fn normalize_word(&self, word: &str) -> String {
        let config = self.config.read().expect("Lock poisoned");

        if !config.detect_obfuscation {
            return word.to_lowercase();
        }

        let mut normalized = String::new();
        let lower = word.to_lowercase();
        let chars: Vec<char> = lower.chars().collect();

        for c in &chars {
            let mut found = false;
            for (original, substitutions) in &config.substitution_map {
                if substitutions.contains(c) {
                    normalized.push(*original);
                    found = true;
                    break;
                }
            }
            if !found {
                normalized.push(*c);
            }
        }

        normalized
    }

    /// Extracts words from content.
    fn extract_words(&self, content: &str) -> Vec<(String, usize, usize)> {
        self.word_regex
            .find_iter(content)
            .map(|m| (m.as_str().to_string(), m.start(), m.end()))
            .collect()
    }

    /// Checks a single word against the filter.
    fn check_word(&self, word: &str) -> Option<(Severity, FilterAction)> {
        let config = self.config.read().expect("Lock poisoned");
        let lower = word.to_lowercase();

        // Check exceptions first
        if config.exceptions.contains(&lower) {
            return None;
        }

        // Check exact blocked match
        if config.blocked_words.contains(&lower) {
            return Some((Severity::High, FilterAction::Block));
        }

        // Check exact warned match
        if config.warned_words.contains(&lower) {
            return Some((Severity::Medium, FilterAction::Warn));
        }

        // Check normalized (obfuscation detection)
        if config.detect_obfuscation {
            let normalized = self.normalize_word_internal(&lower, &config);

            if config.blocked_words.contains(&normalized) {
                return Some((Severity::High, FilterAction::Block));
            }

            if config.warned_words.contains(&normalized) {
                return Some((Severity::Medium, FilterAction::Warn));
            }
        }

        None
    }

    /// Normalizes a word with config access.
    fn normalize_word_internal(&self, word: &str, config: &ProfanityConfig) -> String {
        let mut normalized = String::new();

        for c in word.chars() {
            let mut found = false;
            for (original, substitutions) in &config.substitution_map {
                if substitutions.contains(&c) {
                    normalized.push(*original);
                    found = true;
                    break;
                }
            }
            if !found {
                normalized.push(c);
            }
        }

        normalized
    }

    /// Checks content for partial matches (profanity embedded in words).
    fn check_partial(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let mut matches = Vec::new();

        if !config.check_partial_matches {
            return matches;
        }

        let lower = content.to_lowercase();

        for blocked in &config.blocked_words {
            if blocked.len() < config.min_word_length {
                continue;
            }

            let mut start = 0;
            while let Some(pos) = lower[start..].find(&blocked.to_lowercase()) {
                let abs_start = start + pos;
                let abs_end = abs_start + blocked.len();

                matches.push(
                    FilterMatch::new(
                        "profanity",
                        "partial_match",
                        &content[abs_start..abs_end.min(content.len())],
                        abs_start,
                        abs_end,
                    )
                    .with_severity(Severity::Medium)
                    .with_action(FilterAction::Warn)
                    .with_context("blocked_word", blocked.clone()),
                );

                start = abs_end;
                if start >= content.len() {
                    break;
                }
            }
        }

        matches
    }

    /// Filters content and returns all matches.
    pub fn find_all(&self, content: &str) -> Vec<FilterMatch> {
        let mut matches = Vec::new();
        let words = self.extract_words(content);

        for (word, start, end) in words {
            if let Some((severity, action)) = self.check_word(&word) {
                matches.push(
                    FilterMatch::new("profanity", "word_match", word, start, end)
                        .with_severity(severity)
                        .with_action(action),
                );
            }
        }

        // Also check partial matches if enabled
        let partial_matches = self.check_partial(content);
        matches.extend(partial_matches);

        matches
    }

    /// Redacts profanity from content.
    pub fn redact_content(&self, content: &str) -> String {
        let config = self.config.read().expect("Lock poisoned");
        let matches = self.find_all(content);
        self.redact(content, &matches, &config.replacement)
    }
}

#[async_trait]
impl ContentFilter for ProfanityFilter {
    fn name(&self) -> &str {
        "profanity"
    }

    fn description(&self) -> &str {
        "Detects and filters profanity with obfuscation detection"
    }

    fn supported_types(&self) -> Vec<ContentType> {
        vec![
            ContentType::Text,
            ContentType::Chat,
            ContentType::Email,
            ContentType::Document,
            ContentType::FormData,
        ]
    }

    fn config(&self) -> &FilterConfig {
        // This is a bit of a hack - we return a static reference
        // In production, you'd want a better design
        static DEFAULT_CONFIG: std::sync::OnceLock<FilterConfig> = std::sync::OnceLock::new();
        DEFAULT_CONFIG.get_or_init(|| {
            let prof_config = ProfanityConfig::default();
            prof_config.base
        })
    }

    fn set_config(&mut self, config: FilterConfig) {
        let mut current = self.config.write().expect("Lock poisoned");
        current.base = config;
    }

    fn filter(&self, content: &str, _content_type: ContentType) -> FilterResult {
        let config = self.config.read().expect("Lock poisoned");

        if !config.base.enabled {
            return FilterResult::clean();
        }

        // Check content length limit
        if config.base.max_content_length > 0 && content.len() > config.base.max_content_length {
            return FilterResult::clean();
        }

        let matches = self.find_all(content);

        if matches.is_empty() {
            return FilterResult::clean();
        }

        // Filter matches by minimum severity
        let filtered_matches: Vec<_> = matches
            .into_iter()
            .filter(|m| m.severity >= config.base.min_severity)
            .collect();

        if filtered_matches.is_empty() {
            return FilterResult::clean();
        }

        // Determine if blocked
        let blocked = filtered_matches.iter().any(|m| m.action == FilterAction::Block);

        // Create processed content if redactions needed
        let processed_content = if filtered_matches
            .iter()
            .any(|m| m.action == FilterAction::Redact)
            || blocked
        {
            Some(self.redact_content(content))
        } else {
            None
        };

        let mut result = FilterResult::with_matches(filtered_matches);
        if let Some(processed) = processed_content {
            result = result.with_processed_content(processed);
        }

        result
    }

    fn redact(&self, content: &str, matches: &[FilterMatch], replacement: &str) -> String {
        let mut result = content.to_string();
        let mut sorted_matches: Vec<_> = matches.iter().collect();
        sorted_matches.sort_by(|a, b| b.start.cmp(&a.start));

        for m in sorted_matches {
            if m.end <= result.len() {
                result.replace_range(m.start..m.end, replacement);
            }
        }
        result
    }
}

/// Builder for creating profanity filters with custom configuration.
pub struct ProfanityFilterBuilder {
    config: ProfanityConfig,
}

impl ProfanityFilterBuilder {
    /// Creates a new builder.
    #[must_use]
    pub fn new() -> Self {
        Self {
            config: ProfanityConfig::default(),
        }
    }

    /// Adds a blocked word.
    #[must_use]
    pub fn block(mut self, word: impl Into<String>) -> Self {
        self.config.blocked_words.insert(word.into().to_lowercase());
        self
    }

    /// Adds multiple blocked words.
    #[must_use]
    pub fn block_words(mut self, words: &[&str]) -> Self {
        for word in words {
            self.config.blocked_words.insert(word.to_lowercase());
        }
        self
    }

    /// Adds a warned word.
    #[must_use]
    pub fn warn(mut self, word: impl Into<String>) -> Self {
        self.config.warned_words.insert(word.into().to_lowercase());
        self
    }

    /// Adds multiple warned words.
    #[must_use]
    pub fn warn_words(mut self, words: &[&str]) -> Self {
        for word in words {
            self.config.warned_words.insert(word.to_lowercase());
        }
        self
    }

    /// Adds an exception.
    #[must_use]
    pub fn exception(mut self, word: impl Into<String>) -> Self {
        self.config.exceptions.insert(word.into().to_lowercase());
        self
    }

    /// Enables obfuscation detection.
    #[must_use]
    pub fn detect_obfuscation(mut self, enable: bool) -> Self {
        self.config.detect_obfuscation = enable;
        self
    }

    /// Enables partial matching.
    #[must_use]
    pub fn check_partial(mut self, enable: bool) -> Self {
        self.config.check_partial_matches = enable;
        self
    }

    /// Sets the replacement string.
    #[must_use]
    pub fn replacement(mut self, replacement: impl Into<String>) -> Self {
        self.config.replacement = replacement.into();
        self
    }

    /// Sets the minimum word length to check.
    #[must_use]
    pub fn min_word_length(mut self, length: usize) -> Self {
        self.config.min_word_length = length;
        self
    }

    /// Sets the default action.
    #[must_use]
    pub fn action(mut self, action: FilterAction) -> Self {
        self.config.base.default_action = action;
        self
    }

    /// Builds the filter.
    #[must_use]
    pub fn build(self) -> ProfanityFilter {
        ProfanityFilter::new(self.config)
    }
}

impl Default for ProfanityFilterBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profanity_filter_creation() {
        let filter = ProfanityFilter::with_defaults();
        assert_eq!(filter.name(), "profanity");
    }

    #[test]
    fn test_word_normalization() {
        let filter = ProfanityFilter::with_defaults();

        // Test with common substitutions
        assert_eq!(filter.normalize_word("d4mn"), "damn");
        assert_eq!(filter.normalize_word("sh1t"), "shit");
        assert_eq!(filter.normalize_word("@ss"), "ass");
    }

    #[test]
    fn test_profanity_detection() {
        let filter = ProfanityFilter::with_defaults();

        let result = filter.filter("This is a damn good example", ContentType::Text);
        assert!(result.matched);

        let clean_result = filter.filter("This is a perfectly fine message", ContentType::Text);
        assert!(!clean_result.matched);
    }

    #[test]
    fn test_profanity_redaction() {
        let filter = ProfanityFilter::with_defaults();

        let content = "What the hell is going on?";
        let redacted = filter.redact_content(content);
        assert!(redacted.contains("[REDACTED]"));
    }

    #[test]
    fn test_builder() {
        let filter = ProfanityFilterBuilder::new()
            .block("custom_bad_word")
            .warn("mildly_offensive")
            .exception("hell") // Allow "hell" as in "hello"
            .detect_obfuscation(true)
            .replacement("[CENSORED]")
            .build();

        let result = filter.filter("This custom_bad_word is filtered", ContentType::Text);
        assert!(result.matched);
    }

    #[test]
    fn test_exceptions() {
        let filter = ProfanityFilterBuilder::new()
            .block("hell")
            .exception("hell") // Allow "hell"
            .build();

        // "hell" should be allowed due to exception
        let result = filter.filter("What the hell", ContentType::Text);
        assert!(!result.matched);
    }

    #[test]
    fn test_obfuscation_detection() {
        let filter = ProfanityFilterBuilder::new()
            .block("damn")
            .detect_obfuscation(true)
            .build();

        // Obfuscated versions should be detected
        let result = filter.filter("What the d4mn", ContentType::Text);
        assert!(result.matched);

        let result = filter.filter("What the d@mn", ContentType::Text);
        assert!(result.matched);
    }
}

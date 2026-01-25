//! Content filtering system for the Governor safety system.
//!
//! This module provides a flexible content filtering framework with:
//! - A common trait for all filters
//! - Filter chaining and composition
//! - Result aggregation
//! - Configurable severity levels

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

#[cfg(feature = "profanity-filter")]
pub mod profanity;
#[cfg(feature = "pii-filter")]
pub mod pii;
#[cfg(feature = "injection-filter")]
pub mod injection;

// Re-export main filter types
#[cfg(feature = "profanity-filter")]
pub use profanity::ProfanityFilter;
#[cfg(feature = "pii-filter")]
pub use pii::PIIFilter;
#[cfg(feature = "injection-filter")]
pub use injection::InjectionFilter;

/// Severity level for filter matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Informational only, no action required
    Info = 0,
    /// Low severity, might warrant attention
    Low = 1,
    /// Medium severity, should be reviewed
    Medium = 2,
    /// High severity, likely needs blocking
    High = 3,
    /// Critical severity, must be blocked
    Critical = 4,
}

impl Default for Severity {
    fn default() -> Self {
        Self::Medium
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Info => write!(f, "info"),
            Self::Low => write!(f, "low"),
            Self::Medium => write!(f, "medium"),
            Self::High => write!(f, "high"),
            Self::Critical => write!(f, "critical"),
        }
    }
}

impl Severity {
    /// Returns true if this severity should be blocked.
    #[must_use]
    pub const fn should_block(&self) -> bool {
        matches!(self, Self::High | Self::Critical)
    }

    /// Returns the numeric level of this severity.
    #[must_use]
    pub const fn level(&self) -> u8 {
        *self as u8
    }

    /// Parses a severity from a string.
    ///
    /// # Errors
    /// Returns an error if the string is not a valid severity.
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "info" => Ok(Self::Info),
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            "critical" => Ok(Self::Critical),
            _ => Err(format!("Invalid severity: {s}")),
        }
    }
}

/// Action to take when a filter matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FilterAction {
    /// Allow the content through (no action)
    #[default]
    Allow,
    /// Warn but allow the content
    Warn,
    /// Redact the matched content
    Redact,
    /// Block the content entirely
    Block,
}

impl fmt::Display for FilterAction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Allow => write!(f, "allow"),
            Self::Warn => write!(f, "warn"),
            Self::Redact => write!(f, "redact"),
            Self::Block => write!(f, "block"),
        }
    }
}

/// Type of content being filtered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentType {
    /// Plain text
    Text,
    /// JSON data
    Json,
    /// HTML content
    Html,
    /// Markdown content
    Markdown,
    /// Code (any programming language)
    Code,
    /// URL/URI
    Url,
    /// Email content
    Email,
    /// User input form data
    FormData,
    /// Chat/message content
    Chat,
    /// Document content
    Document,
}

impl Default for ContentType {
    fn default() -> Self {
        Self::Text
    }
}

/// A single match result from a content filter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterMatch {
    /// The filter that produced this match
    pub filter_name: String,
    /// Type of match (e.g., "profanity", "ssn", "email")
    pub match_type: String,
    /// The matched content (may be truncated)
    pub matched_text: String,
    /// Start position in the original content
    pub start: usize,
    /// End position in the original content
    pub end: usize,
    /// Severity of this match
    pub severity: Severity,
    /// Suggested action
    pub action: FilterAction,
    /// Additional context/metadata
    pub context: HashMap<String, String>,
}

impl FilterMatch {
    /// Creates a new filter match.
    #[must_use]
    pub fn new(
        filter_name: impl Into<String>,
        match_type: impl Into<String>,
        matched_text: impl Into<String>,
        start: usize,
        end: usize,
    ) -> Self {
        Self {
            filter_name: filter_name.into(),
            match_type: match_type.into(),
            matched_text: matched_text.into(),
            start,
            end,
            severity: Severity::default(),
            action: FilterAction::default(),
            context: HashMap::new(),
        }
    }

    /// Sets the severity.
    #[must_use]
    pub fn with_severity(mut self, severity: Severity) -> Self {
        self.severity = severity;
        self
    }

    /// Sets the action.
    #[must_use]
    pub fn with_action(mut self, action: FilterAction) -> Self {
        self.action = action;
        self
    }

    /// Adds context metadata.
    #[must_use]
    pub fn with_context(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.context.insert(key.into(), value.into());
        self
    }
}

/// Result of a content filter operation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FilterResult {
    /// Whether any filter matched
    pub matched: bool,
    /// Whether the content should be blocked
    pub blocked: bool,
    /// All matches found
    pub matches: Vec<FilterMatch>,
    /// Processed content (if redactions were applied)
    pub processed_content: Option<String>,
    /// Total number of matches
    pub total_matches: usize,
    /// Highest severity found
    pub highest_severity: Option<Severity>,
    /// Recommended action
    pub recommended_action: FilterAction,
}

impl FilterResult {
    /// Creates an empty (no match) result.
    #[must_use]
    pub fn clean() -> Self {
        Self::default()
    }

    /// Creates a result with matches.
    #[must_use]
    pub fn with_matches(matches: Vec<FilterMatch>) -> Self {
        let matched = !matches.is_empty();
        let blocked = matches.iter().any(|m| m.action == FilterAction::Block);
        let total_matches = matches.len();
        let highest_severity = matches.iter().map(|m| m.severity).max();
        let recommended_action = matches
            .iter()
            .map(|m| m.action)
            .max_by_key(|a| match a {
                FilterAction::Allow => 0,
                FilterAction::Warn => 1,
                FilterAction::Redact => 2,
                FilterAction::Block => 3,
            })
            .unwrap_or_default();

        Self {
            matched,
            blocked,
            matches,
            processed_content: None,
            total_matches,
            highest_severity,
            recommended_action,
        }
    }

    /// Sets the processed content.
    #[must_use]
    pub fn with_processed_content(mut self, content: impl Into<String>) -> Self {
        self.processed_content = Some(content.into());
        self
    }

    /// Returns matches of a specific type.
    #[must_use]
    pub fn matches_of_type(&self, match_type: &str) -> Vec<&FilterMatch> {
        self.matches
            .iter()
            .filter(|m| m.match_type == match_type)
            .collect()
    }

    /// Returns matches from a specific filter.
    #[must_use]
    pub fn matches_from_filter(&self, filter_name: &str) -> Vec<&FilterMatch> {
        self.matches
            .iter()
            .filter(|m| m.filter_name == filter_name)
            .collect()
    }

    /// Returns matches at or above a severity level.
    #[must_use]
    pub fn matches_above_severity(&self, severity: Severity) -> Vec<&FilterMatch> {
        self.matches
            .iter()
            .filter(|m| m.severity >= severity)
            .collect()
    }

    /// Merges another filter result into this one.
    pub fn merge(&mut self, other: FilterResult) {
        if other.matched {
            self.matched = true;
        }
        if other.blocked {
            self.blocked = true;
        }
        self.matches.extend(other.matches);
        self.total_matches = self.matches.len();

        // Update highest severity
        if let Some(sev) = other.highest_severity {
            self.highest_severity = Some(
                self.highest_severity
                    .map_or(sev, |current| current.max(sev)),
            );
        }

        // Update recommended action
        self.recommended_action = match (self.recommended_action, other.recommended_action) {
            (FilterAction::Block, _) | (_, FilterAction::Block) => FilterAction::Block,
            (FilterAction::Redact, _) | (_, FilterAction::Redact) => FilterAction::Redact,
            (FilterAction::Warn, _) | (_, FilterAction::Warn) => FilterAction::Warn,
            _ => FilterAction::Allow,
        };

        // Use the processed content if available
        if other.processed_content.is_some() {
            self.processed_content = other.processed_content;
        }
    }
}

/// Configuration options for content filters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterConfig {
    /// Whether the filter is enabled
    pub enabled: bool,
    /// Minimum severity to report
    pub min_severity: Severity,
    /// Default action for matches
    pub default_action: FilterAction,
    /// Maximum content length to process (0 = unlimited)
    pub max_content_length: usize,
    /// Whether to truncate matched text in results
    pub truncate_matches: bool,
    /// Maximum length for truncated match text
    pub max_match_length: usize,
    /// Additional filter-specific settings
    pub settings: HashMap<String, String>,
}

impl Default for FilterConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_severity: Severity::Info,
            default_action: FilterAction::Warn,
            max_content_length: 0,
            truncate_matches: true,
            max_match_length: 50,
            settings: HashMap::new(),
        }
    }
}

impl FilterConfig {
    /// Creates a new filter configuration.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets whether the filter is enabled.
    #[must_use]
    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// Sets the minimum severity.
    #[must_use]
    pub fn with_min_severity(mut self, severity: Severity) -> Self {
        self.min_severity = severity;
        self
    }

    /// Sets the default action.
    #[must_use]
    pub fn with_action(mut self, action: FilterAction) -> Self {
        self.default_action = action;
        self
    }

    /// Sets a filter-specific setting.
    #[must_use]
    pub fn with_setting(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.settings.insert(key.into(), value.into());
        self
    }

    /// Gets a filter-specific setting.
    #[must_use]
    pub fn get_setting(&self, key: &str) -> Option<&String> {
        self.settings.get(key)
    }
}

/// The main trait for content filters.
///
/// All content filters must implement this trait to be used in the
/// governor's filtering pipeline.
#[async_trait]
pub trait ContentFilter: Send + Sync {
    /// Returns the name of this filter.
    fn name(&self) -> &str;

    /// Returns the description of this filter.
    fn description(&self) -> &str;

    /// Returns the content types this filter can process.
    fn supported_types(&self) -> Vec<ContentType>;

    /// Returns the current configuration.
    fn config(&self) -> &FilterConfig;

    /// Updates the filter configuration.
    fn set_config(&mut self, config: FilterConfig);

    /// Checks if this filter can handle the given content type.
    fn can_handle(&self, content_type: ContentType) -> bool {
        self.supported_types().contains(&content_type) || self.supported_types().is_empty()
    }

    /// Filters content synchronously.
    ///
    /// # Arguments
    /// * `content` - The content to filter
    /// * `content_type` - The type of content
    ///
    /// # Returns
    /// The filter result with any matches found
    fn filter(&self, content: &str, content_type: ContentType) -> FilterResult;

    /// Filters content asynchronously.
    ///
    /// # Arguments
    /// * `content` - The content to filter
    /// * `content_type` - The type of content
    ///
    /// # Returns
    /// The filter result with any matches found
    async fn filter_async(&self, content: &str, content_type: ContentType) -> FilterResult {
        // Default implementation just calls the sync version
        self.filter(content, content_type)
    }

    /// Redacts matched content in the input.
    ///
    /// # Arguments
    /// * `content` - The original content
    /// * `matches` - The matches to redact
    /// * `replacement` - The replacement string (e.g., "[REDACTED]")
    ///
    /// # Returns
    /// The content with matches redacted
    fn redact(&self, content: &str, matches: &[FilterMatch], replacement: &str) -> String {
        let mut result = content.to_string();
        // Sort matches by position in reverse order to maintain positions
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

/// A composite filter that runs multiple filters in sequence.
pub struct CompositeFilter {
    /// The filters to run
    filters: Vec<Arc<dyn ContentFilter>>,
    /// The configuration
    config: FilterConfig,
}

impl CompositeFilter {
    /// Creates a new composite filter.
    #[must_use]
    pub fn new() -> Self {
        Self {
            filters: Vec::new(),
            config: FilterConfig::default(),
        }
    }

    /// Adds a filter to the composite.
    pub fn add_filter(&mut self, filter: Arc<dyn ContentFilter>) {
        self.filters.push(filter);
    }

    /// Removes a filter from the composite.
    pub fn remove_filter(&mut self, name: &str) -> bool {
        let initial_len = self.filters.len();
        self.filters.retain(|f| f.name() != name);
        self.filters.len() != initial_len
    }

    /// Returns the number of filters.
    #[must_use]
    pub fn filter_count(&self) -> usize {
        self.filters.len()
    }

    /// Returns the filter names.
    #[must_use]
    pub fn filter_names(&self) -> Vec<&str> {
        self.filters.iter().map(|f| f.name()).collect()
    }

    /// Runs all filters and combines the results.
    pub fn run_all(&self, content: &str, content_type: ContentType) -> FilterResult {
        let mut combined = FilterResult::clean();
        let mut current_content = content.to_string();

        for filter in &self.filters {
            if !filter.config().enabled {
                continue;
            }
            if !filter.can_handle(content_type) {
                continue;
            }

            let result = filter.filter(&current_content, content_type);

            // If blocking, stop immediately
            if result.blocked {
                combined.merge(result);
                return combined;
            }

            // If content was processed, use it for next filter
            if let Some(ref processed) = result.processed_content {
                current_content = processed.clone();
            }

            combined.merge(result);
        }

        if combined.matched && combined.processed_content.is_none() {
            combined.processed_content = Some(current_content);
        }

        combined
    }
}

impl Default for CompositeFilter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ContentFilter for CompositeFilter {
    fn name(&self) -> &str {
        "composite"
    }

    fn description(&self) -> &str {
        "Composite filter that runs multiple filters in sequence"
    }

    fn supported_types(&self) -> Vec<ContentType> {
        // Composite filter supports all types
        vec![]
    }

    fn config(&self) -> &FilterConfig {
        &self.config
    }

    fn set_config(&mut self, config: FilterConfig) {
        self.config = config;
    }

    fn filter(&self, content: &str, content_type: ContentType) -> FilterResult {
        self.run_all(content, content_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_severity_ordering() {
        assert!(Severity::Critical > Severity::High);
        assert!(Severity::High > Severity::Medium);
        assert!(Severity::Medium > Severity::Low);
        assert!(Severity::Low > Severity::Info);
    }

    #[test]
    fn test_filter_match() {
        let m = FilterMatch::new("test", "profanity", "bad", 0, 3)
            .with_severity(Severity::High)
            .with_action(FilterAction::Block);

        assert_eq!(m.filter_name, "test");
        assert_eq!(m.match_type, "profanity");
        assert_eq!(m.severity, Severity::High);
        assert_eq!(m.action, FilterAction::Block);
    }

    #[test]
    fn test_filter_result() {
        let m1 = FilterMatch::new("f1", "type1", "match1", 0, 6)
            .with_severity(Severity::Low);
        let m2 = FilterMatch::new("f2", "type2", "match2", 10, 16)
            .with_severity(Severity::High)
            .with_action(FilterAction::Block);

        let result = FilterResult::with_matches(vec![m1, m2]);

        assert!(result.matched);
        assert!(result.blocked);
        assert_eq!(result.total_matches, 2);
        assert_eq!(result.highest_severity, Some(Severity::High));
    }

    #[test]
    fn test_filter_config() {
        let config = FilterConfig::new()
            .with_enabled(true)
            .with_min_severity(Severity::Medium)
            .with_action(FilterAction::Redact)
            .with_setting("custom", "value");

        assert!(config.enabled);
        assert_eq!(config.min_severity, Severity::Medium);
        assert_eq!(config.default_action, FilterAction::Redact);
        assert_eq!(config.get_setting("custom"), Some(&"value".to_string()));
    }
}

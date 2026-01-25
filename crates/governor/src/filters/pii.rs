//! PII (Personally Identifiable Information) filter for the Governor safety system.
//!
//! This module provides comprehensive PII detection and redaction:
//! - Email addresses
//! - Phone numbers (multiple formats)
//! - Social Security Numbers
//! - Credit card numbers
//! - IP addresses
//! - Custom regex patterns

use crate::filters::{ContentFilter, FilterConfig, FilterMatch, FilterResult, ContentType, FilterAction, Severity};
use async_trait::async_trait;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;

/// Types of PII that can be detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PIIType {
    /// Email addresses
    Email,
    /// Phone numbers
    Phone,
    /// Social Security Numbers
    SSN,
    /// Credit card numbers
    CreditCard,
    /// IPv4 addresses
    IPv4,
    /// IPv6 addresses
    IPv6,
    /// MAC addresses
    MacAddress,
    /// Bank account numbers
    BankAccount,
    /// Driver's license numbers
    DriversLicense,
    /// Passport numbers
    Passport,
    /// National ID numbers
    NationalId,
    /// Date of birth
    DateOfBirth,
    /// Postal/ZIP codes
    PostalCode,
    /// Street addresses
    StreetAddress,
    /// Full names
    FullName,
    /// Username
    Username,
    /// API keys
    ApiKey,
    /// Custom pattern
    Custom,
}

impl std::fmt::Display for PIIType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Email => write!(f, "email"),
            Self::Phone => write!(f, "phone"),
            Self::SSN => write!(f, "ssn"),
            Self::CreditCard => write!(f, "credit_card"),
            Self::IPv4 => write!(f, "ipv4"),
            Self::IPv6 => write!(f, "ipv6"),
            Self::MacAddress => write!(f, "mac_address"),
            Self::BankAccount => write!(f, "bank_account"),
            Self::DriversLicense => write!(f, "drivers_license"),
            Self::Passport => write!(f, "passport"),
            Self::NationalId => write!(f, "national_id"),
            Self::DateOfBirth => write!(f, "date_of_birth"),
            Self::PostalCode => write!(f, "postal_code"),
            Self::StreetAddress => write!(f, "street_address"),
            Self::FullName => write!(f, "full_name"),
            Self::Username => write!(f, "username"),
            Self::ApiKey => write!(f, "api_key"),
            Self::Custom => write!(f, "custom"),
        }
    }
}

/// Configuration for the PII filter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PIIConfig {
    /// Base filter configuration
    pub base: FilterConfig,
    /// Which PII types to detect
    pub enabled_types: HashMap<PIIType, bool>,
    /// Custom regex patterns
    pub custom_patterns: Vec<CustomPattern>,
    /// Replacement format for each type
    pub replacements: HashMap<PIIType, String>,
    /// Severity for each type
    pub severities: HashMap<PIIType, Severity>,
    /// Action for each type
    pub actions: HashMap<PIIType, FilterAction>,
    /// Whether to validate detected PII
    pub validate: bool,
    /// Context words that may indicate PII nearby
    pub context_words: HashMap<PIIType, Vec<String>>,
}

/// A custom regex pattern for PII detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPattern {
    /// Name of the pattern
    pub name: String,
    /// Regex pattern
    pub pattern: String,
    /// PII type
    pub pii_type: PIIType,
    /// Severity
    pub severity: Severity,
    /// Action
    pub action: FilterAction,
    /// Replacement
    pub replacement: String,
}

impl Default for PIIConfig {
    fn default() -> Self {
        let mut enabled_types = HashMap::new();
        enabled_types.insert(PIIType::Email, true);
        enabled_types.insert(PIIType::Phone, true);
        enabled_types.insert(PIIType::SSN, true);
        enabled_types.insert(PIIType::CreditCard, true);
        enabled_types.insert(PIIType::IPv4, true);
        enabled_types.insert(PIIType::IPv6, true);
        enabled_types.insert(PIIType::MacAddress, true);
        enabled_types.insert(PIIType::ApiKey, true);

        let mut replacements = HashMap::new();
        replacements.insert(PIIType::Email, "[EMAIL]".to_string());
        replacements.insert(PIIType::Phone, "[PHONE]".to_string());
        replacements.insert(PIIType::SSN, "[SSN]".to_string());
        replacements.insert(PIIType::CreditCard, "[CARD]".to_string());
        replacements.insert(PIIType::IPv4, "[IP]".to_string());
        replacements.insert(PIIType::IPv6, "[IP]".to_string());
        replacements.insert(PIIType::MacAddress, "[MAC]".to_string());
        replacements.insert(PIIType::ApiKey, "[API_KEY]".to_string());

        let mut severities = HashMap::new();
        severities.insert(PIIType::SSN, Severity::Critical);
        severities.insert(PIIType::CreditCard, Severity::Critical);
        severities.insert(PIIType::BankAccount, Severity::Critical);
        severities.insert(PIIType::Email, Severity::High);
        severities.insert(PIIType::Phone, Severity::High);
        severities.insert(PIIType::IPv4, Severity::Medium);
        severities.insert(PIIType::IPv6, Severity::Medium);
        severities.insert(PIIType::MacAddress, Severity::Medium);
        severities.insert(PIIType::ApiKey, Severity::High);

        let mut actions = HashMap::new();
        actions.insert(PIIType::SSN, FilterAction::Block);
        actions.insert(PIIType::CreditCard, FilterAction::Block);
        actions.insert(PIIType::Email, FilterAction::Redact);
        actions.insert(PIIType::Phone, FilterAction::Redact);

        Self {
            base: FilterConfig::default(),
            enabled_types,
            custom_patterns: Vec::new(),
            replacements,
            severities,
            actions,
            validate: true,
            context_words: HashMap::new(),
        }
    }
}

impl PIIConfig {
    /// Creates a new PII configuration.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Enables a PII type.
    #[must_use]
    pub fn enable(mut self, pii_type: PIIType) -> Self {
        self.enabled_types.insert(pii_type, true);
        self
    }

    /// Disables a PII type.
    #[must_use]
    pub fn disable(mut self, pii_type: PIIType) -> Self {
        self.enabled_types.insert(pii_type, false);
        self
    }

    /// Sets the replacement for a PII type.
    #[must_use]
    pub fn with_replacement(mut self, pii_type: PIIType, replacement: impl Into<String>) -> Self {
        self.replacements.insert(pii_type, replacement.into());
        self
    }

    /// Sets the severity for a PII type.
    #[must_use]
    pub fn with_severity(mut self, pii_type: PIIType, severity: Severity) -> Self {
        self.severities.insert(pii_type, severity);
        self
    }

    /// Adds a custom pattern.
    #[must_use]
    pub fn add_custom_pattern(mut self, pattern: CustomPattern) -> Self {
        self.custom_patterns.push(pattern);
        self
    }

    /// Checks if a PII type is enabled.
    #[must_use]
    pub fn is_enabled(&self, pii_type: PIIType) -> bool {
        self.enabled_types.get(&pii_type).copied().unwrap_or(false)
    }
}

/// Compiled patterns for PII detection.
struct CompiledPatterns {
    email: Regex,
    phone_us: Regex,
    phone_intl: Regex,
    ssn: Regex,
    credit_card: Regex,
    ipv4: Regex,
    ipv6: Regex,
    mac_address: Regex,
    api_key: Regex,
    custom: Vec<(Regex, CustomPattern)>,
}

impl CompiledPatterns {
    fn new(config: &PIIConfig) -> Self {
        Self {
            email: Regex::new(r"(?i)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")
                .expect("Invalid email regex"),
            phone_us: Regex::new(r"\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b")
                .expect("Invalid phone_us regex"),
            phone_intl: Regex::new(r"\b\+?[1-9]\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b")
                .expect("Invalid phone_intl regex"),
            ssn: Regex::new(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b")
                .expect("Invalid ssn regex"),
            credit_card: Regex::new(r"\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{13,16}\b")
                .expect("Invalid credit_card regex"),
            ipv4: Regex::new(r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b")
                .expect("Invalid ipv4 regex"),
            ipv6: Regex::new(r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b")
                .expect("Invalid ipv6 regex"),
            mac_address: Regex::new(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")
                .expect("Invalid mac_address regex"),
            api_key: Regex::new(r"(?i)(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|bearer)\s*[=:]\s*['\"]?([A-Za-z0-9_\-]{20,})['\"]?")
                .expect("Invalid api_key regex"),
            custom: config
                .custom_patterns
                .iter()
                .filter_map(|p| Regex::new(&p.pattern).ok().map(|r| (r, p.clone())))
                .collect(),
        }
    }
}

/// The PII filter implementation.
pub struct PIIFilter {
    /// Configuration
    config: RwLock<PIIConfig>,
    /// Compiled patterns
    patterns: RwLock<CompiledPatterns>,
}

impl Default for PIIFilter {
    fn default() -> Self {
        Self::new(PIIConfig::default())
    }
}

impl PIIFilter {
    /// Creates a new PII filter with the given configuration.
    #[must_use]
    pub fn new(config: PIIConfig) -> Self {
        let patterns = CompiledPatterns::new(&config);
        Self {
            config: RwLock::new(config),
            patterns: RwLock::new(patterns),
        }
    }

    /// Creates a new PII filter with default configuration.
    #[must_use]
    pub fn with_defaults() -> Self {
        Self::default()
    }

    /// Updates the configuration.
    pub fn update_config(&self, config: PIIConfig) {
        let patterns = CompiledPatterns::new(&config);
        *self.patterns.write().expect("Lock poisoned") = patterns;
        *self.config.write().expect("Lock poisoned") = config;
    }

    /// Gets the current configuration.
    #[must_use]
    pub fn get_config(&self) -> PIIConfig {
        self.config.read().expect("Lock poisoned").clone()
    }

    /// Detects email addresses.
    fn detect_emails(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let patterns = self.patterns.read().expect("Lock poisoned");

        if !config.is_enabled(PIIType::Email) {
            return Vec::new();
        }

        patterns
            .email
            .find_iter(content)
            .map(|m| {
                FilterMatch::new("pii", PIIType::Email.to_string(), m.as_str(), m.start(), m.end())
                    .with_severity(
                        config
                            .severities
                            .get(&PIIType::Email)
                            .copied()
                            .unwrap_or(Severity::High),
                    )
                    .with_action(
                        config
                            .actions
                            .get(&PIIType::Email)
                            .copied()
                            .unwrap_or(FilterAction::Redact),
                    )
            })
            .collect()
    }

    /// Detects phone numbers.
    fn detect_phones(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let patterns = self.patterns.read().expect("Lock poisoned");

        if !config.is_enabled(PIIType::Phone) {
            return Vec::new();
        }

        let mut matches = Vec::new();
        let severity = config
            .severities
            .get(&PIIType::Phone)
            .copied()
            .unwrap_or(Severity::High);
        let action = config
            .actions
            .get(&PIIType::Phone)
            .copied()
            .unwrap_or(FilterAction::Redact);

        for m in patterns.phone_us.find_iter(content) {
            matches.push(
                FilterMatch::new("pii", PIIType::Phone.to_string(), m.as_str(), m.start(), m.end())
                    .with_severity(severity)
                    .with_action(action)
                    .with_context("format", "us"),
            );
        }

        for m in patterns.phone_intl.find_iter(content) {
            // Skip if already matched by US pattern
            if matches.iter().any(|existing| {
                existing.start <= m.start() && existing.end >= m.end()
            }) {
                continue;
            }
            matches.push(
                FilterMatch::new("pii", PIIType::Phone.to_string(), m.as_str(), m.start(), m.end())
                    .with_severity(severity)
                    .with_action(action)
                    .with_context("format", "intl"),
            );
        }

        matches
    }

    /// Detects SSNs.
    fn detect_ssns(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let patterns = self.patterns.read().expect("Lock poisoned");

        if !config.is_enabled(PIIType::SSN) {
            return Vec::new();
        }

        patterns
            .ssn
            .find_iter(content)
            .map(|m| {
                FilterMatch::new("pii", PIIType::SSN.to_string(), m.as_str(), m.start(), m.end())
                    .with_severity(Severity::Critical)
                    .with_action(FilterAction::Block)
            })
            .collect()
    }

    /// Detects credit card numbers.
    fn detect_credit_cards(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let patterns = self.patterns.read().expect("Lock poisoned");

        if !config.is_enabled(PIIType::CreditCard) {
            return Vec::new();
        }

        let mut matches = Vec::new();

        for m in patterns.credit_card.find_iter(content) {
            let digits: String = m.as_str().chars().filter(|c| c.is_ascii_digit()).collect();

            // Validate using Luhn algorithm if validation is enabled
            if config.validate && !self.luhn_check(&digits) {
                continue;
            }

            matches.push(
                FilterMatch::new(
                    "pii",
                    PIIType::CreditCard.to_string(),
                    m.as_str(),
                    m.start(),
                    m.end(),
                )
                .with_severity(Severity::Critical)
                .with_action(FilterAction::Block)
                .with_context("card_type", self.identify_card_type(&digits)),
            );
        }

        matches
    }

    /// Validates a number using the Luhn algorithm.
    fn luhn_check(&self, number: &str) -> bool {
        let digits: Vec<u32> = number
            .chars()
            .filter_map(|c| c.to_digit(10))
            .collect();

        if digits.len() < 13 || digits.len() > 19 {
            return false;
        }

        let mut sum = 0;
        let mut alternate = false;

        for &d in digits.iter().rev() {
            let mut n = d;
            if alternate {
                n *= 2;
                if n > 9 {
                    n -= 9;
                }
            }
            sum += n;
            alternate = !alternate;
        }

        sum % 10 == 0
    }

    /// Identifies the credit card type from the number.
    fn identify_card_type(&self, number: &str) -> &'static str {
        let prefix: u64 = number.chars().take(6).collect::<String>().parse().unwrap_or(0);
        let len = number.len();

        // Visa
        if (number.starts_with('4') && (len == 13 || len == 16 || len == 19)) {
            return "visa";
        }
        // MasterCard
        if (prefix >= 222100 && prefix <= 272099 && len == 16)
            || (prefix >= 51 && prefix <= 55 && len == 16)
        {
            return "mastercard";
        }
        // American Express
        if (number.starts_with("34") || number.starts_with("37")) && len == 15 {
            return "amex";
        }
        // Discover
        if number.starts_with("6011") || (prefix >= 622126 && prefix <= 622925) || number.starts_with("65") {
            return "discover";
        }

        "unknown"
    }

    /// Detects IP addresses.
    fn detect_ips(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let patterns = self.patterns.read().expect("Lock poisoned");

        let mut matches = Vec::new();

        if config.is_enabled(PIIType::IPv4) {
            for m in patterns.ipv4.find_iter(content) {
                matches.push(
                    FilterMatch::new("pii", PIIType::IPv4.to_string(), m.as_str(), m.start(), m.end())
                        .with_severity(
                            config
                                .severities
                                .get(&PIIType::IPv4)
                                .copied()
                                .unwrap_or(Severity::Medium),
                        )
                        .with_action(
                            config
                                .actions
                                .get(&PIIType::IPv4)
                                .copied()
                                .unwrap_or(FilterAction::Warn),
                        ),
                );
            }
        }

        if config.is_enabled(PIIType::IPv6) {
            for m in patterns.ipv6.find_iter(content) {
                matches.push(
                    FilterMatch::new("pii", PIIType::IPv6.to_string(), m.as_str(), m.start(), m.end())
                        .with_severity(
                            config
                                .severities
                                .get(&PIIType::IPv6)
                                .copied()
                                .unwrap_or(Severity::Medium),
                        )
                        .with_action(
                            config
                                .actions
                                .get(&PIIType::IPv6)
                                .copied()
                                .unwrap_or(FilterAction::Warn),
                        ),
                );
            }
        }

        matches
    }

    /// Detects MAC addresses.
    fn detect_mac_addresses(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let patterns = self.patterns.read().expect("Lock poisoned");

        if !config.is_enabled(PIIType::MacAddress) {
            return Vec::new();
        }

        patterns
            .mac_address
            .find_iter(content)
            .map(|m| {
                FilterMatch::new(
                    "pii",
                    PIIType::MacAddress.to_string(),
                    m.as_str(),
                    m.start(),
                    m.end(),
                )
                .with_severity(
                    config
                        .severities
                        .get(&PIIType::MacAddress)
                        .copied()
                        .unwrap_or(Severity::Medium),
                )
                .with_action(
                    config
                        .actions
                        .get(&PIIType::MacAddress)
                        .copied()
                        .unwrap_or(FilterAction::Warn),
                )
            })
            .collect()
    }

    /// Detects API keys.
    fn detect_api_keys(&self, content: &str) -> Vec<FilterMatch> {
        let config = self.config.read().expect("Lock poisoned");
        let patterns = self.patterns.read().expect("Lock poisoned");

        if !config.is_enabled(PIIType::ApiKey) {
            return Vec::new();
        }

        patterns
            .api_key
            .captures_iter(content)
            .filter_map(|caps| {
                caps.get(1).map(|m| {
                    FilterMatch::new("pii", PIIType::ApiKey.to_string(), m.as_str(), m.start(), m.end())
                        .with_severity(Severity::High)
                        .with_action(FilterAction::Block)
                })
            })
            .collect()
    }

    /// Detects custom patterns.
    fn detect_custom(&self, content: &str) -> Vec<FilterMatch> {
        let patterns = self.patterns.read().expect("Lock poisoned");

        patterns
            .custom
            .iter()
            .flat_map(|(regex, pattern)| {
                regex.find_iter(content).map(move |m| {
                    FilterMatch::new(
                        "pii",
                        pattern.pii_type.to_string(),
                        m.as_str(),
                        m.start(),
                        m.end(),
                    )
                    .with_severity(pattern.severity)
                    .with_action(pattern.action)
                    .with_context("pattern_name", pattern.name.clone())
                })
            })
            .collect()
    }

    /// Finds all PII in the content.
    pub fn find_all(&self, content: &str) -> Vec<FilterMatch> {
        let mut matches = Vec::new();
        matches.extend(self.detect_emails(content));
        matches.extend(self.detect_phones(content));
        matches.extend(self.detect_ssns(content));
        matches.extend(self.detect_credit_cards(content));
        matches.extend(self.detect_ips(content));
        matches.extend(self.detect_mac_addresses(content));
        matches.extend(self.detect_api_keys(content));
        matches.extend(self.detect_custom(content));

        // Sort by start position
        matches.sort_by_key(|m| m.start);
        matches
    }

    /// Redacts PII from content.
    pub fn redact_content(&self, content: &str) -> String {
        let config = self.config.read().expect("Lock poisoned");
        let matches = self.find_all(content);

        let mut result = content.to_string();
        let mut sorted_matches: Vec<_> = matches.iter().collect();
        sorted_matches.sort_by(|a, b| b.start.cmp(&a.start));

        for m in sorted_matches {
            let pii_type = match m.match_type.as_str() {
                "email" => PIIType::Email,
                "phone" => PIIType::Phone,
                "ssn" => PIIType::SSN,
                "credit_card" => PIIType::CreditCard,
                "ipv4" => PIIType::IPv4,
                "ipv6" => PIIType::IPv6,
                "mac_address" => PIIType::MacAddress,
                "api_key" => PIIType::ApiKey,
                _ => PIIType::Custom,
            };

            let replacement = config
                .replacements
                .get(&pii_type)
                .map(String::as_str)
                .unwrap_or("[REDACTED]");

            if m.end <= result.len() {
                result.replace_range(m.start..m.end, replacement);
            }
        }

        result
    }
}

#[async_trait]
impl ContentFilter for PIIFilter {
    fn name(&self) -> &str {
        "pii"
    }

    fn description(&self) -> &str {
        "Detects and filters personally identifiable information"
    }

    fn supported_types(&self) -> Vec<ContentType> {
        vec![
            ContentType::Text,
            ContentType::Json,
            ContentType::Email,
            ContentType::Document,
            ContentType::FormData,
        ]
    }

    fn config(&self) -> &FilterConfig {
        static DEFAULT_CONFIG: std::sync::OnceLock<FilterConfig> = std::sync::OnceLock::new();
        DEFAULT_CONFIG.get_or_init(|| {
            let pii_config = PIIConfig::default();
            pii_config.base
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

        let matches = self.find_all(content);

        if matches.is_empty() {
            return FilterResult::clean();
        }

        // Filter by minimum severity
        let filtered_matches: Vec<_> = matches
            .into_iter()
            .filter(|m| m.severity >= config.base.min_severity)
            .collect();

        if filtered_matches.is_empty() {
            return FilterResult::clean();
        }

        let blocked = filtered_matches.iter().any(|m| m.action == FilterAction::Block);
        let needs_redaction = filtered_matches
            .iter()
            .any(|m| m.action == FilterAction::Redact);

        let processed_content = if needs_redaction || blocked {
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

/// Builder for creating PII filters with custom configuration.
pub struct PIIFilterBuilder {
    config: PIIConfig,
}

impl PIIFilterBuilder {
    /// Creates a new builder.
    #[must_use]
    pub fn new() -> Self {
        Self {
            config: PIIConfig::default(),
        }
    }

    /// Enables a PII type.
    #[must_use]
    pub fn enable(mut self, pii_type: PIIType) -> Self {
        self.config.enabled_types.insert(pii_type, true);
        self
    }

    /// Disables a PII type.
    #[must_use]
    pub fn disable(mut self, pii_type: PIIType) -> Self {
        self.config.enabled_types.insert(pii_type, false);
        self
    }

    /// Sets the replacement for a PII type.
    #[must_use]
    pub fn replacement(mut self, pii_type: PIIType, replacement: impl Into<String>) -> Self {
        self.config.replacements.insert(pii_type, replacement.into());
        self
    }

    /// Sets the severity for a PII type.
    #[must_use]
    pub fn severity(mut self, pii_type: PIIType, severity: Severity) -> Self {
        self.config.severities.insert(pii_type, severity);
        self
    }

    /// Sets the action for a PII type.
    #[must_use]
    pub fn action(mut self, pii_type: PIIType, action: FilterAction) -> Self {
        self.config.actions.insert(pii_type, action);
        self
    }

    /// Enables validation.
    #[must_use]
    pub fn validate(mut self, validate: bool) -> Self {
        self.config.validate = validate;
        self
    }

    /// Adds a custom pattern.
    #[must_use]
    pub fn custom_pattern(
        mut self,
        name: impl Into<String>,
        pattern: impl Into<String>,
        pii_type: PIIType,
        severity: Severity,
        action: FilterAction,
    ) -> Self {
        self.config.custom_patterns.push(CustomPattern {
            name: name.into(),
            pattern: pattern.into(),
            pii_type,
            severity,
            action,
            replacement: "[CUSTOM]".to_string(),
        });
        self
    }

    /// Builds the filter.
    #[must_use]
    pub fn build(self) -> PIIFilter {
        PIIFilter::new(self.config)
    }
}

impl Default for PIIFilterBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pii_filter_creation() {
        let filter = PIIFilter::with_defaults();
        assert_eq!(filter.name(), "pii");
    }

    #[test]
    fn test_email_detection() {
        let filter = PIIFilter::with_defaults();

        let result = filter.filter("Contact me at test@example.com", ContentType::Text);
        assert!(result.matched);
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].match_type, "email");
    }

    #[test]
    fn test_phone_detection() {
        let filter = PIIFilter::with_defaults();

        let result = filter.filter("Call me at 555-123-4567", ContentType::Text);
        assert!(result.matched);
        assert_eq!(result.matches[0].match_type, "phone");
    }

    #[test]
    fn test_ssn_detection() {
        let filter = PIIFilter::with_defaults();

        let result = filter.filter("SSN: 123-45-6789", ContentType::Text);
        assert!(result.matched);
        assert!(result.blocked); // SSN should block
    }

    #[test]
    fn test_credit_card_detection() {
        let filter = PIIFilter::with_defaults();

        // Valid test credit card number (passes Luhn)
        let result = filter.filter("Card: 4532015112830366", ContentType::Text);
        assert!(result.matched);
        assert!(result.blocked);
    }

    #[test]
    fn test_luhn_check() {
        let filter = PIIFilter::with_defaults();

        // Valid test numbers
        assert!(filter.luhn_check("4532015112830366"));
        assert!(filter.luhn_check("5500000000000004"));
        assert!(filter.luhn_check("340000000000009"));

        // Invalid numbers
        assert!(!filter.luhn_check("4532015112830367"));
        assert!(!filter.luhn_check("1234567890123456"));
    }

    #[test]
    fn test_ip_detection() {
        let filter = PIIFilter::with_defaults();

        let result = filter.filter("Server IP: 192.168.1.1", ContentType::Text);
        assert!(result.matched);
        assert_eq!(result.matches[0].match_type, "ipv4");
    }

    #[test]
    fn test_redaction() {
        let filter = PIIFilter::with_defaults();

        let content = "Email: test@example.com and phone: 555-123-4567";
        let redacted = filter.redact_content(content);

        assert!(!redacted.contains("test@example.com"));
        assert!(!redacted.contains("555-123-4567"));
        assert!(redacted.contains("[EMAIL]"));
        assert!(redacted.contains("[PHONE]"));
    }

    #[test]
    fn test_builder() {
        let filter = PIIFilterBuilder::new()
            .disable(PIIType::Email)
            .severity(PIIType::Phone, Severity::Critical)
            .action(PIIType::Phone, FilterAction::Block)
            .build();

        // Email should not be detected
        let result = filter.filter("test@example.com", ContentType::Text);
        assert!(!result.matched);

        // Phone should be critical and block
        let result = filter.filter("555-123-4567", ContentType::Text);
        assert!(result.matched);
        assert!(result.blocked);
    }
}

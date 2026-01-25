//! Error types for the Governor safety system.
//!
//! This module provides comprehensive error handling for all governor operations,
//! including permission errors, boundary violations, filter errors, and more.

use std::path::PathBuf;
use thiserror::Error;

/// The main result type for governor operations.
pub type Result<T> = std::result::Result<T, GovernorError>;

/// The main error type for the Governor safety system.
///
/// This enum encompasses all possible errors that can occur during
/// governor operations, with detailed error messages and context.
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum GovernorError {
    // =========================================================================
    // Permission Errors
    // =========================================================================

    /// The requested permission has been denied.
    #[error("Permission denied: {permission} - {reason}")]
    PermissionDenied {
        /// The permission that was denied
        permission: String,
        /// The reason for denial
        reason: String,
    },

    /// The requested permission is not granted to the current context.
    #[error("Permission not granted: {permission}")]
    PermissionNotGranted {
        /// The permission that was requested
        permission: String,
    },

    /// Invalid permission string that cannot be parsed.
    #[error("Invalid permission string: '{input}' - {reason}")]
    InvalidPermissionString {
        /// The invalid input string
        input: String,
        /// The reason for the error
        reason: String,
    },

    /// Permission conflict detected.
    #[error("Permission conflict: {permission} conflicts with {conflicting_permission}")]
    PermissionConflict {
        /// The first permission
        permission: String,
        /// The conflicting permission
        conflicting_permission: String,
    },

    /// Permission condition evaluation failed.
    #[error("Permission condition evaluation failed for '{permission}': {reason}")]
    PermissionConditionFailed {
        /// The permission being evaluated
        permission: String,
        /// The reason for failure
        reason: String,
    },

    // =========================================================================
    // Boundary Errors
    // =========================================================================

    /// A resource boundary has been violated.
    #[error("Boundary violation: {boundary} - current: {current}, limit: {limit}")]
    BoundaryViolation {
        /// The boundary that was violated
        boundary: String,
        /// The current value
        current: String,
        /// The limit that was exceeded
        limit: String,
    },

    /// Memory limit exceeded.
    #[error("Memory limit exceeded: used {used_bytes} bytes, limit is {limit_bytes} bytes")]
    MemoryLimitExceeded {
        /// Bytes used
        used_bytes: u64,
        /// Byte limit
        limit_bytes: u64,
    },

    /// CPU time limit exceeded.
    #[error("CPU time limit exceeded: used {used_ms}ms, limit is {limit_ms}ms")]
    CpuTimeLimitExceeded {
        /// Milliseconds used
        used_ms: u64,
        /// Millisecond limit
        limit_ms: u64,
    },

    /// Execution timeout.
    #[error("Execution timeout after {timeout_ms}ms")]
    ExecutionTimeout {
        /// Timeout in milliseconds
        timeout_ms: u64,
    },

    /// Wall time limit exceeded.
    #[error("Wall time limit exceeded: elapsed {elapsed_ms}ms, limit is {limit_ms}ms")]
    WallTimeLimitExceeded {
        /// Milliseconds elapsed
        elapsed_ms: u64,
        /// Millisecond limit
        limit_ms: u64,
    },

    /// File size limit exceeded.
    #[error("File size limit exceeded: file '{path}' is {actual_size} bytes, limit is {limit_bytes} bytes")]
    FileSizeLimitExceeded {
        /// Path to the file
        path: PathBuf,
        /// Actual file size
        actual_size: u64,
        /// Size limit
        limit_bytes: u64,
    },

    /// Network bandwidth limit exceeded.
    #[error("Network bandwidth limit exceeded: {direction} - {used_bytes} bytes, limit is {limit_bytes} bytes")]
    NetworkBandwidthExceeded {
        /// Direction (inbound/outbound)
        direction: String,
        /// Bytes used
        used_bytes: u64,
        /// Byte limit
        limit_bytes: u64,
    },

    // =========================================================================
    // Filter Errors
    // =========================================================================

    /// Content filter matched prohibited content.
    #[error("Content filter matched: {filter_type} - matched '{matched_content}'")]
    ContentFilterMatched {
        /// Type of filter that matched
        filter_type: String,
        /// The content that was matched
        matched_content: String,
    },

    /// PII detected in content.
    #[error("PII detected: {pii_type} - {message}")]
    PiiDetected {
        /// Type of PII detected
        pii_type: String,
        /// Additional message
        message: String,
    },

    /// Injection attempt detected.
    #[error("Injection attempt detected: {injection_type} - {message}")]
    InjectionDetected {
        /// Type of injection
        injection_type: String,
        /// Additional message
        message: String,
    },

    /// Profanity detected in content.
    #[error("Profanity detected: found {count} instance(s)")]
    ProfanityDetected {
        /// Number of profanity instances found
        count: usize,
    },

    /// Filter configuration error.
    #[error("Filter configuration error: {filter_name} - {reason}")]
    FilterConfigError {
        /// Name of the filter
        filter_name: String,
        /// Reason for the error
        reason: String,
    },

    // =========================================================================
    // Rate Limiter Errors
    // =========================================================================

    /// Rate limit exceeded.
    #[error("Rate limit exceeded: {key} - {message}")]
    RateLimitExceeded {
        /// The rate limit key
        key: String,
        /// Additional message
        message: String,
    },

    /// Rate limit configuration error.
    #[error("Rate limit configuration error: {reason}")]
    RateLimitConfigError {
        /// Reason for the error
        reason: String,
    },

    /// Invalid rate limit algorithm specified.
    #[error("Invalid rate limit algorithm: '{algorithm}'")]
    InvalidRateLimitAlgorithm {
        /// The invalid algorithm name
        algorithm: String,
    },

    // =========================================================================
    // Sandbox Errors
    // =========================================================================

    /// Sandbox creation failed.
    #[error("Sandbox creation failed: {reason}")]
    SandboxCreationFailed {
        /// Reason for failure
        reason: String,
    },

    /// Sandbox execution failed.
    #[error("Sandbox execution failed: {reason}")]
    SandboxExecutionFailed {
        /// Reason for failure
        reason: String,
    },

    /// Sandbox isolation error.
    #[error("Sandbox isolation error: {isolation_type} - {reason}")]
    SandboxIsolationError {
        /// Type of isolation
        isolation_type: String,
        /// Reason for error
        reason: String,
    },

    /// Sandbox resource error.
    #[error("Sandbox resource error: {resource} - {reason}")]
    SandboxResourceError {
        /// The resource involved
        resource: String,
        /// Reason for error
        reason: String,
    },

    // =========================================================================
    // Audit Errors
    // =========================================================================

    /// Audit log write failed.
    #[error("Audit log write failed: {reason}")]
    AuditLogWriteFailed {
        /// Reason for failure
        reason: String,
    },

    /// Audit log read failed.
    #[error("Audit log read failed: {reason}")]
    AuditLogReadFailed {
        /// Reason for failure
        reason: String,
    },

    /// Audit query error.
    #[error("Audit query error: {reason}")]
    AuditQueryError {
        /// Reason for error
        reason: String,
    },

    /// Audit event serialization error.
    #[error("Audit event serialization error: {reason}")]
    AuditSerializationError {
        /// Reason for error
        reason: String,
    },

    // =========================================================================
    // Configuration Errors
    // =========================================================================

    /// Configuration error.
    #[error("Configuration error: {reason}")]
    ConfigError {
        /// Reason for error
        reason: String,
    },

    /// Missing configuration value.
    #[error("Missing configuration value: '{key}'")]
    MissingConfigValue {
        /// The missing configuration key
        key: String,
    },

    /// Invalid configuration value.
    #[error("Invalid configuration value for '{key}': {reason}")]
    InvalidConfigValue {
        /// The configuration key
        key: String,
        /// Reason for error
        reason: String,
    },

    // =========================================================================
    // I/O Errors
    // =========================================================================

    /// File I/O error.
    #[error("I/O error for '{path}': {reason}")]
    IoError {
        /// The file path
        path: PathBuf,
        /// Reason for error
        reason: String,
    },

    /// File not found.
    #[error("File not found: '{path}'")]
    FileNotFound {
        /// The file path
        path: PathBuf,
    },

    /// Permission denied for file operation.
    #[error("File permission denied: '{path}'")]
    FilePermissionDenied {
        /// The file path
        path: PathBuf,
    },

    // =========================================================================
    // Parsing Errors
    // =========================================================================

    /// JSON parsing error.
    #[error("JSON parsing error: {reason}")]
    JsonParseError {
        /// Reason for error
        reason: String,
    },

    /// TOML parsing error.
    #[error("TOML parsing error: {reason}")]
    TomlParseError {
        /// Reason for error
        reason: String,
    },

    /// Regex pattern error.
    #[error("Regex pattern error: '{pattern}' - {reason}")]
    RegexPatternError {
        /// The pattern
        pattern: String,
        /// Reason for error
        reason: String,
    },

    // =========================================================================
    // Internal Errors
    // =========================================================================

    /// Internal error that shouldn't occur.
    #[error("Internal error: {reason}")]
    InternalError {
        /// Reason for error
        reason: String,
    },

    /// Feature not implemented.
    #[error("Feature not implemented: {feature}")]
    NotImplemented {
        /// The feature that's not implemented
        feature: String,
    },

    /// Invalid state error.
    #[error("Invalid state: expected {expected}, got {actual}")]
    InvalidState {
        /// Expected state
        expected: String,
        /// Actual state
        actual: String,
    },

    /// Lock acquisition failed.
    #[error("Lock acquisition failed: {resource}")]
    LockAcquisitionFailed {
        /// The resource that couldn't be locked
        resource: String,
    },

    /// Channel communication error.
    #[error("Channel error: {reason}")]
    ChannelError {
        /// Reason for error
        reason: String,
    },

    /// Cancellation requested.
    #[error("Operation cancelled")]
    Cancelled,

    /// Unknown error with message.
    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl GovernorError {
    /// Creates a new permission denied error.
    #[must_use]
    pub fn permission_denied(permission: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::PermissionDenied {
            permission: permission.into(),
            reason: reason.into(),
        }
    }

    /// Creates a new boundary violation error.
    #[must_use]
    pub fn boundary_violation(
        boundary: impl Into<String>,
        current: impl Into<String>,
        limit: impl Into<String>,
    ) -> Self {
        Self::BoundaryViolation {
            boundary: boundary.into(),
            current: current.into(),
            limit: limit.into(),
        }
    }

    /// Creates a new rate limit exceeded error.
    #[must_use]
    pub fn rate_limit_exceeded(key: impl Into<String>, message: impl Into<String>) -> Self {
        Self::RateLimitExceeded {
            key: key.into(),
            message: message.into(),
        }
    }

    /// Creates a new content filter matched error.
    #[must_use]
    pub fn content_filter_matched(
        filter_type: impl Into<String>,
        matched_content: impl Into<String>,
    ) -> Self {
        Self::ContentFilterMatched {
            filter_type: filter_type.into(),
            matched_content: matched_content.into(),
        }
    }

    /// Creates a new sandbox execution failed error.
    #[must_use]
    pub fn sandbox_execution_failed(reason: impl Into<String>) -> Self {
        Self::SandboxExecutionFailed {
            reason: reason.into(),
        }
    }

    /// Creates a new configuration error.
    #[must_use]
    pub fn config_error(reason: impl Into<String>) -> Self {
        Self::ConfigError {
            reason: reason.into(),
        }
    }

    /// Creates a new internal error.
    #[must_use]
    pub fn internal(reason: impl Into<String>) -> Self {
        Self::InternalError {
            reason: reason.into(),
        }
    }

    /// Returns true if this error indicates a permission was denied.
    #[must_use]
    pub const fn is_permission_error(&self) -> bool {
        matches!(
            self,
            Self::PermissionDenied { .. }
                | Self::PermissionNotGranted { .. }
                | Self::PermissionConflict { .. }
                | Self::PermissionConditionFailed { .. }
        )
    }

    /// Returns true if this error indicates a boundary was violated.
    #[must_use]
    pub const fn is_boundary_error(&self) -> bool {
        matches!(
            self,
            Self::BoundaryViolation { .. }
                | Self::MemoryLimitExceeded { .. }
                | Self::CpuTimeLimitExceeded { .. }
                | Self::ExecutionTimeout { .. }
                | Self::WallTimeLimitExceeded { .. }
                | Self::FileSizeLimitExceeded { .. }
                | Self::NetworkBandwidthExceeded { .. }
        )
    }

    /// Returns true if this error indicates a filter matched.
    #[must_use]
    pub const fn is_filter_error(&self) -> bool {
        matches!(
            self,
            Self::ContentFilterMatched { .. }
                | Self::PiiDetected { .. }
                | Self::InjectionDetected { .. }
                | Self::ProfanityDetected { .. }
        )
    }

    /// Returns true if this error indicates rate limiting.
    #[must_use]
    pub const fn is_rate_limit_error(&self) -> bool {
        matches!(
            self,
            Self::RateLimitExceeded { .. } | Self::RateLimitConfigError { .. }
        )
    }

    /// Returns true if this error indicates a sandbox issue.
    #[must_use]
    pub const fn is_sandbox_error(&self) -> bool {
        matches!(
            self,
            Self::SandboxCreationFailed { .. }
                | Self::SandboxExecutionFailed { .. }
                | Self::SandboxIsolationError { .. }
                | Self::SandboxResourceError { .. }
        )
    }

    /// Returns true if this error is recoverable.
    #[must_use]
    pub const fn is_recoverable(&self) -> bool {
        matches!(
            self,
            Self::RateLimitExceeded { .. }
                | Self::ExecutionTimeout { .. }
                | Self::LockAcquisitionFailed { .. }
                | Self::ChannelError { .. }
                | Self::Cancelled
        )
    }

    /// Returns the error category as a string.
    #[must_use]
    pub fn category(&self) -> &'static str {
        match self {
            Self::PermissionDenied { .. }
            | Self::PermissionNotGranted { .. }
            | Self::InvalidPermissionString { .. }
            | Self::PermissionConflict { .. }
            | Self::PermissionConditionFailed { .. } => "permission",

            Self::BoundaryViolation { .. }
            | Self::MemoryLimitExceeded { .. }
            | Self::CpuTimeLimitExceeded { .. }
            | Self::ExecutionTimeout { .. }
            | Self::WallTimeLimitExceeded { .. }
            | Self::FileSizeLimitExceeded { .. }
            | Self::NetworkBandwidthExceeded { .. } => "boundary",

            Self::ContentFilterMatched { .. }
            | Self::PiiDetected { .. }
            | Self::InjectionDetected { .. }
            | Self::ProfanityDetected { .. }
            | Self::FilterConfigError { .. } => "filter",

            Self::RateLimitExceeded { .. }
            | Self::RateLimitConfigError { .. }
            | Self::InvalidRateLimitAlgorithm { .. } => "rate_limit",

            Self::SandboxCreationFailed { .. }
            | Self::SandboxExecutionFailed { .. }
            | Self::SandboxIsolationError { .. }
            | Self::SandboxResourceError { .. } => "sandbox",

            Self::AuditLogWriteFailed { .. }
            | Self::AuditLogReadFailed { .. }
            | Self::AuditQueryError { .. }
            | Self::AuditSerializationError { .. } => "audit",

            Self::ConfigError { .. }
            | Self::MissingConfigValue { .. }
            | Self::InvalidConfigValue { .. } => "config",

            Self::IoError { .. }
            | Self::FileNotFound { .. }
            | Self::FilePermissionDenied { .. } => "io",

            Self::JsonParseError { .. }
            | Self::TomlParseError { .. }
            | Self::RegexPatternError { .. } => "parse",

            Self::InternalError { .. }
            | Self::NotImplemented { .. }
            | Self::InvalidState { .. }
            | Self::LockAcquisitionFailed { .. }
            | Self::ChannelError { .. }
            | Self::Cancelled { .. }
            | Self::Unknown(_) => "internal",
        }
    }
}

impl From<serde_json::Error> for GovernorError {
    fn from(err: serde_json::Error) -> Self {
        Self::JsonParseError {
            reason: err.to_string(),
        }
    }
}

impl From<toml::de::Error> for GovernorError {
    fn from(err: toml::de::Error) -> Self {
        Self::TomlParseError {
            reason: err.to_string(),
        }
    }
}

impl From<regex::Error> for GovernorError {
    fn from(err: regex::Error) -> Self {
        Self::RegexPatternError {
            pattern: String::new(),
            reason: err.to_string(),
        }
    }
}

impl From<std::io::Error> for GovernorError {
    fn from(err: std::io::Error) -> Self {
        Self::IoError {
            path: PathBuf::new(),
            reason: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_creation() {
        let err = GovernorError::permission_denied("file_read", "Access denied");
        assert!(err.is_permission_error());
        assert_eq!(err.category(), "permission");
    }

    #[test]
    fn test_boundary_error() {
        let err = GovernorError::boundary_violation("memory", "1GB", "512MB");
        assert!(err.is_boundary_error());
        assert_eq!(err.category(), "boundary");
    }

    #[test]
    fn test_rate_limit_error() {
        let err = GovernorError::rate_limit_exceeded("user:123", "Too many requests");
        assert!(err.is_rate_limit_error());
        assert!(err.is_recoverable());
    }

    #[test]
    fn test_filter_error() {
        let err = GovernorError::content_filter_matched("profanity", "bad_word");
        assert!(err.is_filter_error());
        assert_eq!(err.category(), "filter");
    }

    #[test]
    fn test_error_categories() {
        assert_eq!(GovernorError::Cancelled.category(), "internal");
        assert_eq!(
            GovernorError::SandboxExecutionFailed {
                reason: String::new()
            }
            .category(),
            "sandbox"
        );
        assert_eq!(
            GovernorError::AuditLogWriteFailed {
                reason: String::new()
            }
            .category(),
            "audit"
        );
    }
}

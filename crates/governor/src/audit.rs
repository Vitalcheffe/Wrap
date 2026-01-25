//! Audit logging for the Governor safety system.
//!
//! This module provides comprehensive audit logging:
//! - Event recording with detailed context
//! - Multiple storage backends (memory, file)
//! - Query and filtering capabilities
//! - Event retention and cleanup

use crate::error::{GovernorError, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Types of audit events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    /// Permission granted
    PermissionGranted,
    /// Permission denied
    PermissionDenied,
    /// Boundary violation
    BoundaryViolation,
    /// Content filtered
    ContentFiltered,
    /// Rate limit exceeded
    RateLimitExceeded,
    /// Sandbox execution
    SandboxExecution,
    /// Configuration change
    ConfigChange,
    /// Security alert
    SecurityAlert,
    /// User action
    UserAction,
    /// System event
    SystemEvent,
    /// Custom event
    Custom,
}

impl fmt::Display for AuditEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PermissionGranted => write!(f, "permission_granted"),
            Self::PermissionDenied => write!(f, "permission_denied"),
            Self::BoundaryViolation => write!(f, "boundary_violation"),
            Self::ContentFiltered => write!(f, "content_filtered"),
            Self::RateLimitExceeded => write!(f, "rate_limit_exceeded"),
            Self::SandboxExecution => write!(f, "sandbox_execution"),
            Self::ConfigChange => write!(f, "config_change"),
            Self::SecurityAlert => write!(f, "security_alert"),
            Self::UserAction => write!(f, "user_action"),
            Self::SystemEvent => write!(f, "system_event"),
            Self::Custom => write!(f, "custom"),
        }
    }
}

/// Severity level for audit events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum AuditSeverity {
    /// Debug information
    Debug,
    /// Informational event
    Info,
    /// Warning event
    Warning,
    /// Error event
    Error,
    /// Critical security event
    Critical,
}

impl Default for AuditSeverity {
    fn default() -> Self {
        Self::Info
    }
}

impl fmt::Display for AuditSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Debug => write!(f, "debug"),
            Self::Info => write!(f, "info"),
            Self::Warning => write!(f, "warning"),
            Self::Error => write!(f, "error"),
            Self::Critical => write!(f, "critical"),
        }
    }
}

/// An audit event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    /// Unique event ID
    pub id: Uuid,
    /// Event type
    pub event_type: AuditEventType,
    /// Severity level
    pub severity: AuditSeverity,
    /// Timestamp when the event occurred
    pub timestamp: DateTime<Utc>,
    /// User ID (if applicable)
    pub user_id: Option<String>,
    /// Session ID (if applicable)
    pub session_id: Option<String>,
    /// Source of the event (component/module)
    pub source: String,
    /// Event message
    pub message: String,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
    /// Related resource (file, URL, etc.)
    pub resource: Option<String>,
    /// Action taken
    pub action: Option<String>,
    /// Result of the action
    pub result: Option<String>,
    /// IP address (if applicable)
    pub ip_address: Option<String>,
    /// User agent (if applicable)
    pub user_agent: Option<String>,
    /// Duration in milliseconds (if applicable)
    pub duration_ms: Option<u64>,
    /// Correlation ID for linking related events
    pub correlation_id: Option<String>,
}

impl AuditEvent {
    /// Creates a new audit event.
    #[must_use]
    pub fn new(event_type: AuditEventType, source: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            event_type,
            severity: AuditSeverity::default(),
            timestamp: Utc::now(),
            user_id: None,
            session_id: None,
            source: source.into(),
            message: message.into(),
            metadata: HashMap::new(),
            resource: None,
            action: None,
            result: None,
            ip_address: None,
            user_agent: None,
            duration_ms: None,
            correlation_id: None,
        }
    }

    /// Creates a permission granted event.
    #[must_use]
    pub fn permission_granted(permission: &str, resource: &str) -> Self {
        Self::new(
            AuditEventType::PermissionGranted,
            "permission_manager",
            format!("Permission '{permission}' granted for resource '{resource}'"),
        )
        .with_resource(resource)
        .with_metadata("permission", permission)
    }

    /// Creates a permission denied event.
    #[must_use]
    pub fn permission_denied(permission: &str, resource: &str, reason: &str) -> Self {
        Self::new(
            AuditEventType::PermissionDenied,
            "permission_manager",
            format!("Permission '{permission}' denied for resource '{resource}': {reason}"),
        )
        .with_severity(AuditSeverity::Warning)
        .with_resource(resource)
        .with_metadata("permission", permission)
        .with_metadata("reason", reason)
    }

    /// Creates a boundary violation event.
    #[must_use]
    pub fn boundary_violation(boundary: &str, current: &str, limit: &str) -> Self {
        Self::new(
            AuditEventType::BoundaryViolation,
            "boundary_checker",
            format!("Boundary '{boundary}' violated: current={current}, limit={limit}"),
        )
        .with_severity(AuditSeverity::Warning)
        .with_metadata("boundary", boundary)
        .with_metadata("current", current)
        .with_metadata("limit", limit)
    }

    /// Creates a content filtered event.
    #[must_use]
    pub fn content_filtered(filter: &str, match_type: &str, action: &str) -> Self {
        Self::new(
            AuditEventType::ContentFiltered,
            "content_filter",
            format!("Content filtered by '{filter}': {match_type} - {action}"),
        )
        .with_severity(AuditSeverity::Info)
        .with_metadata("filter", filter)
        .with_metadata("match_type", match_type)
        .with_metadata("action", action)
    }

    /// Creates a rate limit exceeded event.
    #[must_use]
    pub fn rate_limit_exceeded(key: &str, limit: u64) -> Self {
        Self::new(
            AuditEventType::RateLimitExceeded,
            "rate_limiter",
            format!("Rate limit exceeded for '{key}' (limit: {limit})"),
        )
        .with_severity(AuditSeverity::Warning)
        .with_metadata("key", key)
        .with_metadata("limit", limit.to_string())
    }

    /// Creates a sandbox execution event.
    #[must_use]
    pub fn sandbox_execution(command: &str, duration_ms: u64, success: bool) -> Self {
        Self::new(
            AuditEventType::SandboxExecution,
            "sandbox",
            format!("Sandbox execution: {command}"),
        )
        .with_duration(duration_ms)
        .with_result(if success { "success" } else { "failure" })
        .with_metadata("command", command)
    }

    /// Sets the severity.
    #[must_use]
    pub fn with_severity(mut self, severity: AuditSeverity) -> Self {
        self.severity = severity;
        self
    }

    /// Sets the user ID.
    #[must_use]
    pub fn with_user(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    /// Sets the session ID.
    #[must_use]
    pub fn with_session(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    /// Sets the resource.
    #[must_use]
    pub fn with_resource(mut self, resource: impl Into<String>) -> Self {
        self.resource = Some(resource.into());
        self
    }

    /// Sets the action.
    #[must_use]
    pub fn with_action(mut self, action: impl Into<String>) -> Self {
        self.action = Some(action.into());
        self
    }

    /// Sets the result.
    #[must_use]
    pub fn with_result(mut self, result: impl Into<String>) -> Self {
        self.result = Some(result.into());
        self
    }

    /// Sets the IP address.
    #[must_use]
    pub fn with_ip(mut self, ip: impl Into<String>) -> Self {
        self.ip_address = Some(ip.into());
        self
    }

    /// Sets the user agent.
    #[must_use]
    pub fn with_user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.user_agent = Some(user_agent.into());
        self
    }

    /// Sets the duration.
    #[must_use]
    pub fn with_duration(mut self, duration_ms: u64) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    /// Sets the correlation ID.
    #[must_use]
    pub fn with_correlation_id(mut self, id: impl Into<String>) -> Self {
        self.correlation_id = Some(id.into());
        self
    }

    /// Adds metadata.
    #[must_use]
    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }

    /// Converts the event to JSON.
    ///
    /// # Errors
    /// Returns an error if serialization fails.
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string(self).map_err(|e| GovernorError::AuditSerializationError {
            reason: e.to_string(),
        })
    }

    /// Parses an event from JSON.
    ///
    /// # Errors
    /// Returns an error if parsing fails.
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|e| GovernorError::AuditSerializationError {
            reason: e.to_string(),
        })
    }
}

/// Query parameters for searching audit events.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditQuery {
    /// Filter by event type
    pub event_type: Option<AuditEventType>,
    /// Filter by severity (minimum)
    pub min_severity: Option<AuditSeverity>,
    /// Filter by user ID
    pub user_id: Option<String>,
    /// Filter by session ID
    pub session_id: Option<String>,
    /// Filter by source
    pub source: Option<String>,
    /// Filter by resource pattern
    pub resource_pattern: Option<String>,
    /// Filter by action
    pub action: Option<String>,
    /// Filter by result
    pub result: Option<String>,
    /// Filter by correlation ID
    pub correlation_id: Option<String>,
    /// Filter by start time
    pub start_time: Option<DateTime<Utc>>,
    /// Filter by end time
    pub end_time: Option<DateTime<Utc>>,
    /// Filter by IP address
    pub ip_address: Option<String>,
    /// Maximum number of results
    pub limit: Option<usize>,
    /// Offset for pagination
    pub offset: Option<usize>,
}

impl AuditQuery {
    /// Creates a new empty query.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Filters by event type.
    #[must_use]
    pub fn with_event_type(mut self, event_type: AuditEventType) -> Self {
        self.event_type = Some(event_type);
        self
    }

    /// Filters by minimum severity.
    #[must_use]
    pub fn with_min_severity(mut self, severity: AuditSeverity) -> Self {
        self.min_severity = Some(severity);
        self
    }

    /// Filters by user ID.
    #[must_use]
    pub fn with_user(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    /// Filters by source.
    #[must_use]
    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    /// Filters by time range.
    #[must_use]
    pub fn with_time_range(mut self, start: DateTime<Utc>, end: DateTime<Utc>) -> Self {
        self.start_time = Some(start);
        self.end_time = Some(end);
        self
    }

    /// Sets the result limit.
    #[must_use]
    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Sets the offset.
    #[must_use]
    pub fn with_offset(mut self, offset: usize) -> Self {
        self.offset = Some(offset);
        self
    }

    /// Checks if an event matches this query.
    #[must_use]
    pub fn matches(&self, event: &AuditEvent) -> bool {
        if let Some(ref event_type) = self.event_type {
            if event.event_type != *event_type {
                return false;
            }
        }

        if let Some(ref min_severity) = self.min_severity {
            if event.severity < *min_severity {
                return false;
            }
        }

        if let Some(ref user_id) = self.user_id {
            if event.user_id.as_ref() != Some(user_id) {
                return false;
            }
        }

        if let Some(ref session_id) = self.session_id {
            if event.session_id.as_ref() != Some(session_id) {
                return false;
            }
        }

        if let Some(ref source) = self.source {
            if !event.source.contains(source) {
                return false;
            }
        }

        if let Some(ref resource_pattern) = self.resource_pattern {
            if let Some(ref resource) = event.resource {
                if !resource.contains(resource_pattern) {
                    return false;
                }
            } else {
                return false;
            }
        }

        if let Some(ref action) = self.action {
            if event.action.as_ref() != Some(action) {
                return false;
            }
        }

        if let Some(ref result) = self.result {
            if event.result.as_ref() != Some(result) {
                return false;
            }
        }

        if let Some(ref correlation_id) = self.correlation_id {
            if event.correlation_id.as_ref() != Some(correlation_id) {
                return false;
            }
        }

        if let Some(ref start_time) = self.start_time {
            if event.timestamp < *start_time {
                return false;
            }
        }

        if let Some(ref end_time) = self.end_time {
            if event.timestamp > *end_time {
                return false;
            }
        }

        if let Some(ref ip_address) = self.ip_address {
            if event.ip_address.as_ref() != Some(ip_address) {
                return false;
            }
        }

        true
    }
}

/// Storage backend for audit logs.
#[derive(Debug, Clone)]
pub enum AuditBackend {
    /// In-memory storage
    Memory,
    /// File-based storage
    File {
        /// Path to the audit log file
        path: PathBuf,
    },
    /// Both memory and file
    Both {
        /// Path to the audit log file
        path: PathBuf,
    },
}

/// Configuration for the audit log.
#[derive(Debug, Clone)]
pub struct AuditConfig {
    /// Storage backend
    pub backend: AuditBackend,
    /// Maximum number of events to keep in memory
    pub max_memory_events: usize,
    /// Whether to include timestamps in file names
    pub timestamp_files: bool,
    /// Event retention period in days (0 = forever)
    pub retention_days: u32,
    /// Whether to flush after every write
    pub flush_immediately: bool,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            backend: AuditBackend::Memory,
            max_memory_events: 10_000,
            timestamp_files: false,
            retention_days: 30,
            flush_immediately: true,
        }
    }
}

impl AuditConfig {
    /// Creates a new audit configuration.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Uses in-memory storage.
    #[must_use]
    pub fn memory() -> Self {
        Self::default()
    }

    /// Uses file-based storage.
    #[must_use]
    pub fn file(path: impl Into<PathBuf>) -> Self {
        Self {
            backend: AuditBackend::File { path: path.into() },
            ..Default::default()
        }
    }

    /// Uses both memory and file storage.
    #[must_use]
    pub fn both(path: impl Into<PathBuf>) -> Self {
        Self {
            backend: AuditBackend::Both { path: path.into() },
            ..Default::default()
        }
    }

    /// Sets the maximum memory events.
    #[must_use]
    pub fn with_max_memory_events(mut self, max: usize) -> Self {
        self.max_memory_events = max;
        self
    }

    /// Sets the retention period in days.
    #[must_use]
    pub fn with_retention_days(mut self, days: u32) -> Self {
        self.retention_days = days;
        self
    }
}

/// The audit log implementation.
pub struct AuditLog {
    /// Configuration
    config: AuditConfig,
    /// In-memory events
    events: RwLock<Vec<AuditEvent>>,
    /// File handle (if using file backend)
    file: RwLock<Option<File>>,
}

impl AuditLog {
    /// Creates a new audit log with the given configuration.
    pub async fn new(config: AuditConfig) -> Self {
        let file = match &config.backend {
            AuditBackend::File { path } | AuditBackend::Both { path } => {
                let f = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .await
                    .ok();
                f
            }
            AuditBackend::Memory => None,
        };

        Self {
            config,
            events: RwLock::new(Vec::new()),
            file: RwLock::new(file),
        }
    }

    /// Creates an in-memory audit log.
    #[must_use]
    pub fn memory() -> Self {
        Self {
            config: AuditConfig::memory(),
            events: RwLock::new(Vec::new()),
            file: RwLock::new(None),
        }
    }

    /// Records an audit event.
    pub async fn record(&self, event: AuditEvent) -> Result<()> {
        // Write to memory if configured
        if matches!(
            self.config.backend,
            AuditBackend::Memory | AuditBackend::Both { .. }
        ) {
            let mut events = self.events.write().await;

            // Enforce max memory events
            if events.len() >= self.config.max_memory_events {
                let remove_count = events.len() - self.config.max_memory_events + 1;
                events.drain(0..remove_count);
            }

            events.push(event.clone());
        }

        // Write to file if configured
        if matches!(
            self.config.backend,
            AuditBackend::File { .. } | AuditBackend::Both { .. }
        ) {
            let mut file_guard = self.file.write().await;

            if let Some(ref mut file) = *file_guard {
                let json = event.to_json()?;
                file.write_all(json.as_bytes()).await?;
                file.write_all(b"\n").await?;

                if self.config.flush_immediately {
                    file.flush().await?;
                }
            }
        }

        Ok(())
    }

    /// Creates and records an event in one call.
    pub async fn log(
        &self,
        event_type: AuditEventType,
        source: impl Into<String>,
        message: impl Into<String>,
    ) -> Result<()> {
        let event = AuditEvent::new(event_type, source, message);
        self.record(event).await
    }

    /// Queries events matching the given criteria.
    pub async fn query(&self, query: &AuditQuery) -> Result<Vec<AuditEvent>> {
        let events = self.events.read().await;

        let mut results: Vec<AuditEvent> = events
            .iter()
            .filter(|e| query.matches(e))
            .cloned()
            .collect();

        // Apply offset
        if let Some(offset) = query.offset {
            results = results.into_iter().skip(offset).collect();
        }

        // Apply limit
        if let Some(limit) = query.limit {
            results = results.into_iter().take(limit).collect();
        }

        Ok(results)
    }

    /// Gets an event by ID.
    pub async fn get(&self, id: Uuid) -> Option<AuditEvent> {
        let events = self.events.read().await;
        events.iter().find(|e| e.id == id).cloned()
    }

    /// Gets the most recent events.
    pub async fn recent(&self, count: usize) -> Vec<AuditEvent> {
        let events = self.events.read().await;
        events.iter().rev().take(count).cloned().collect()
    }

    /// Counts events matching a query.
    pub async fn count(&self, query: &AuditQuery) -> usize {
        let events = self.events.read().await;
        events.iter().filter(|e| query.matches(e)).count()
    }

    /// Clears all events from memory.
    pub async fn clear(&self) {
        let mut events = self.events.write().await;
        events.clear();
    }

    /// Removes events older than the retention period.
    pub async fn cleanup(&self) -> Result<usize> {
        if self.config.retention_days == 0 {
            return Ok(0);
        }

        let cutoff = Utc::now()
            - chrono::Duration::days(i64::from(self.config.retention_days));

        let mut events = self.events.write().await;
        let initial_len = events.len();
        events.retain(|e| e.timestamp >= cutoff);

        Ok(initial_len - events.len())
    }

    /// Gets statistics about the audit log.
    pub async fn stats(&self) -> AuditStats {
        let events = self.events.read().await;

        let mut by_type: HashMap<String, usize> = HashMap::new();
        let mut by_severity: HashMap<String, usize> = HashMap::new();

        for event in events.iter() {
            *by_type.entry(event.event_type.to_string()).or_insert(0) += 1;
            *by_severity
                .entry(event.severity.to_string())
                .or_insert(0) += 1;
        }

        AuditStats {
            total_events: events.len(),
            by_type,
            by_severity,
        }
    }

    /// Exports events to a JSON file.
    pub async fn export(&self, path: &PathBuf) -> Result<()> {
        let events = self.events.read().await;
        let json = serde_json::to_string_pretty(&*events).map_err(|e| {
            GovernorError::AuditSerializationError {
                reason: e.to_string(),
            }
        })?;

        let mut file = File::create(path).await?;
        file.write_all(json.as_bytes()).await?;

        Ok(())
    }
}

/// Statistics about the audit log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditStats {
    /// Total number of events
    pub total_events: usize,
    /// Events by type
    pub by_type: HashMap<String, usize>,
    /// Events by severity
    pub by_severity: HashMap<String, usize>,
}

/// A builder for creating audit events.
pub struct AuditEventBuilder {
    event: AuditEvent,
}

impl AuditEventBuilder {
    /// Creates a new builder.
    #[must_use]
    pub fn new(event_type: AuditEventType, source: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            event: AuditEvent::new(event_type, source, message),
        }
    }

    /// Sets the severity.
    #[must_use]
    pub fn severity(mut self, severity: AuditSeverity) -> Self {
        self.event.severity = severity;
        self
    }

    /// Sets the user ID.
    #[must_use]
    pub fn user(mut self, user_id: impl Into<String>) -> Self {
        self.event.user_id = Some(user_id.into());
        self
    }

    /// Sets the session ID.
    #[must_use]
    pub fn session(mut self, session_id: impl Into<String>) -> Self {
        self.event.session_id = Some(session_id.into());
        self
    }

    /// Sets the resource.
    #[must_use]
    pub fn resource(mut self, resource: impl Into<String>) -> Self {
        self.event.resource = Some(resource.into());
        self
    }

    /// Sets the action.
    #[must_use]
    pub fn action(mut self, action: impl Into<String>) -> Self {
        self.event.action = Some(action.into());
        self
    }

    /// Sets the result.
    #[must_use]
    pub fn result(mut self, result: impl Into<String>) -> Self {
        self.event.result = Some(result.into());
        self
    }

    /// Sets the IP address.
    #[must_use]
    pub fn ip(mut self, ip: impl Into<String>) -> Self {
        self.event.ip_address = Some(ip.into());
        self
    }

    /// Sets the user agent.
    #[must_use]
    pub fn user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.event.user_agent = Some(user_agent.into());
        self
    }

    /// Sets the duration.
    #[must_use]
    pub fn duration(mut self, duration_ms: u64) -> Self {
        self.event.duration_ms = Some(duration_ms);
        self
    }

    /// Sets the correlation ID.
    #[must_use]
    pub fn correlation_id(mut self, id: impl Into<String>) -> Self {
        self.event.correlation_id = Some(id.into());
        self
    }

    /// Adds metadata.
    #[must_use]
    pub fn metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.event.metadata.insert(key.into(), value.into());
        self
    }

    /// Builds the event.
    #[must_use]
    pub fn build(self) -> AuditEvent {
        self.event
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_event_creation() {
        let event = AuditEvent::new(
            AuditEventType::PermissionDenied,
            "test",
            "Test event",
        );

        assert_eq!(event.event_type, AuditEventType::PermissionDenied);
        assert_eq!(event.source, "test");
        assert_eq!(event.message, "Test event");
    }

    #[test]
    fn test_audit_event_builder() {
        let event = AuditEventBuilder::new(
            AuditEventType::PermissionDenied,
            "governor",
            "Permission denied",
        )
        .severity(AuditSeverity::Warning)
        .user("user123")
        .resource("/api/secret")
        .metadata("permission", "admin")
        .build();

        assert_eq!(event.severity, AuditSeverity::Warning);
        assert_eq!(event.user_id, Some("user123".to_string()));
        assert_eq!(event.resource, Some("/api/secret".to_string()));
    }

    #[test]
    fn test_audit_query() {
        let query = AuditQuery::new()
            .with_event_type(AuditEventType::PermissionDenied)
            .with_min_severity(AuditSeverity::Warning)
            .with_user("user123")
            .with_limit(10);

        let event = AuditEvent::permission_denied("read", "/file", "not authorized")
            .with_user("user123");

        assert!(query.matches(&event));

        let other_event = AuditEvent::permission_granted("read", "/file");
        assert!(!query.matches(&other_event));
    }

    #[tokio::test]
    async fn test_audit_log_memory() {
        let log = AuditLog::memory();

        let event = AuditEvent::permission_denied("read", "/file", "test");
        log.record(event.clone()).await.unwrap();

        let results = log.query(&AuditQuery::new()).await.unwrap();
        assert_eq!(results.len(), 1);

        let found = log.get(event.id).await;
        assert!(found.is_some());
    }

    #[tokio::test]
    async fn test_audit_log_recent() {
        let log = AuditLog::memory();

        for i in 0..10 {
            log.record(AuditEvent::new(
                AuditEventType::SystemEvent,
                "test",
                format!("Event {i}"),
            ))
            .await
            .unwrap();
        }

        let recent = log.recent(5).await;
        assert_eq!(recent.len(), 5);
    }

    #[tokio::test]
    async fn test_audit_log_stats() {
        let log = AuditLog::memory();

        log.record(AuditEvent::permission_denied("r", "/f", "test"))
            .await
            .unwrap();
        log.record(AuditEvent::permission_granted("r", "/f"))
            .await
            .unwrap();
        log.record(AuditEvent::rate_limit_exceeded("key", 100))
            .await
            .unwrap();

        let stats = log.stats().await;
        assert_eq!(stats.total_events, 3);
        assert_eq!(stats.by_type.get("permission_denied"), Some(&1));
    }

    #[test]
    fn test_event_serialization() {
        let event = AuditEvent::permission_denied("read", "/file", "test")
            .with_user("user123");

        let json = event.to_json().unwrap();
        let parsed = AuditEvent::from_json(&json).unwrap();

        assert_eq!(event.id, parsed.id);
        assert_eq!(event.event_type, parsed.event_type);
        assert_eq!(event.user_id, parsed.user_id);
    }
}

//! WRAP Safety Governor - Zero Trust Security Layer
//!
//! The Governor provides:
//! - Resource limiting (CPU, memory, time)
//! - Permission enforcement
//! - Content filtering
//! - Rate limiting
//! - Audit logging

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use chrono::{DateTime, Utc};

pub mod permissions;
pub mod boundaries;
pub mod filters;
pub mod rate_limiter;
pub mod audit;

pub use permissions::{Permission, PermissionSet, PermissionCondition};
pub use boundaries::{Boundary, ResourceUsage, BoundaryViolation};
pub use filters::{ContentFilter, FilterResult, FilterCategory};
pub use rate_limiter::{RateLimiter, RateLimit, RateLimitKey};
pub use audit::{AuditLog, AuditEvent, AuditEntry};

/// Main Governor struct that coordinates all security components
pub struct Governor {
    id: Uuid,
    config: GovernorConfig,
    permissions: Arc<RwLock<PermissionSet>>,
    boundaries: Arc<RwLock<Boundary>>,
    rate_limiter: Arc<RateLimiter>,
    audit_log: Arc<AuditLog>,
    started_at: DateTime<Utc>,
}

/// Configuration for the Governor
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernorConfig {
    /// Default timeout for operations (ms)
    pub default_timeout_ms: u64,
    /// Maximum memory usage (bytes)
    pub max_memory_bytes: usize,
    /// Maximum CPU percentage (0-100)
    pub max_cpu_percent: u8,
    /// Enable audit logging
    pub audit_enabled: bool,
    /// Enable content filtering
    pub content_filtering_enabled: bool,
    /// Strict mode (reject on any violation)
    pub strict_mode: bool,
    /// Rate limits
    pub rate_limits: Vec<RateLimit>,
}

impl Default for GovernorConfig {
    fn default() -> Self {
        Self {
            default_timeout_ms: 60_000,
            max_memory_bytes: 512 * 1024 * 1024,
            max_cpu_percent: 50,
            audit_enabled: true,
            content_filtering_enabled: true,
            strict_mode: false,
            rate_limits: vec![RateLimit::new("per_minute", 100, Duration::from_secs(60))],
        }
    }
}

impl Governor {
    /// Create a new Governor instance
    pub fn new(config: GovernorConfig) -> Result<Self, GovernorError> {
        let id = Uuid::new_v4();
        let audit_log = Arc::new(AuditLog::new()?);
        let rate_limiter = Arc::new(RateLimiter::new(config.rate_limits.clone()));
        let permissions = Arc::new(RwLock::new(PermissionSet::default()));
        let boundaries = Arc::new(RwLock::new(Boundary::default()));

        Ok(Self {
            id,
            config,
            permissions,
            boundaries,
            rate_limiter,
            audit_log,
            started_at: Utc::now(),
        })
    }

    /// Get the Governor ID
    pub fn id(&self) -> Uuid {
        self.id
    }

    /// Check if a permission is allowed
    pub async fn check_permission(&self, permission: Permission) -> Result<bool, GovernorError> {
        let perms = self.permissions.read().await;
        let allowed = perms.check(&permission);

        if self.config.audit_enabled {
            self.audit_log.log(AuditEvent::PermissionCheck {
                permission: permission.clone(),
                allowed,
                timestamp: Utc::now(),
            }).await?;
        }

        Ok(allowed)
    }

    /// Grant a permission
    pub async fn grant_permission(&self, permission: Permission) -> Result<(), GovernorError> {
        let mut perms = self.permissions.write().await;
        perms.grant(permission.clone());

        if self.config.audit_enabled {
            self.audit_log.log(AuditEvent::PermissionGranted {
                permission,
                timestamp: Utc::now(),
            }).await?;
        }

        Ok(())
    }

    /// Check rate limit
    pub fn check_rate_limit(&self, key: &RateLimitKey) -> Result<bool, GovernorError> {
        self.rate_limiter.check(key)
    }

    /// Filter content for safety issues
    pub async fn filter_content(&self, content: &str) -> Result<FilterResult, GovernorError> {
        if !self.config.content_filtering_enabled {
            return Ok(FilterResult::allowed());
        }

        let profanity = filters::ProfanityFilter::new();
        let pii = filters::PIIFilter::new();
        let injection = filters::InjectionFilter::new();

        let mut result = profanity.check(content)?;
        if !result.allowed {
            return Ok(result);
        }

        result = pii.check(content)?;
        if !result.allowed {
            return Ok(result);
        }

        result = injection.check(content)?;
        Ok(result)
    }

    /// Get current resource usage
    pub async fn resource_usage(&self) -> ResourceUsage {
        let boundaries = self.boundaries.read().await;
        boundaries.current_usage()
    }

    /// Get Governor statistics
    pub fn stats(&self) -> GovernorStats {
        GovernorStats {
            id: self.id,
            started_at: self.started_at,
            uptime_secs: (Utc::now() - self.started_at).num_seconds() as u64,
            audit_enabled: self.config.audit_enabled,
            strict_mode: self.config.strict_mode,
        }
    }
}

/// Governor statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernorStats {
    pub id: Uuid,
    pub started_at: DateTime<Utc>,
    pub uptime_secs: u64,
    pub audit_enabled: bool,
    pub strict_mode: bool,
}

/// Errors
#[derive(Debug, Error)]
pub enum GovernorError {
    #[error("Memory limit exceeded: used {used} bytes, limit {limit} bytes")]
    MemoryLimitExceeded { used: usize, limit: usize },

    #[error("CPU limit exceeded: used {used}%, limit {limit}%")]
    CpuLimitExceeded { used: f32, limit: u8 },

    #[error("Timeout after {0:?}")]
    Timeout(Duration),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Boundary violation: {0}")]
    BoundaryViolation(String),

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Content filtered: {0}")]
    ContentFiltered(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, GovernorError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_governor_creation() {
        let config = GovernorConfig::default();
        let governor = Governor::new(config).unwrap();
        assert!(!governor.id().is_nil());
    }

    #[tokio::test]
    async fn test_permission_check() {
        let governor = Governor::new(GovernorConfig::default()).unwrap();
        let allowed = governor.check_permission(Permission::FileRead("/etc/passwd".to_string())).await.unwrap();
        assert!(!allowed);
    }
}

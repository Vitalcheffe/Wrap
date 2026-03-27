//! WRAP NEBULA v2.0 - Rust Safety Governor
//! 
//! Zero Trust security enforcement layer for the WRAP NEBULA framework.
//! 
//! # Features
//! - Permission-based access control
//! - Sandbox execution
//! - Audit trail with Ed25519 signatures
//! - Injection filtering
//! - Rate limiting

pub mod audit;
pub mod filters;
pub mod permissions;
pub mod sandbox;

use anyhow::Result;
use thiserror::Error;

/// Governor error types
#[derive(Error, Debug)]
pub enum GovernorError {
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    
    #[error("Sandbox error: {0}")]
    SandboxError(String),
    
    #[error("Injection detected: {0}")]
    InjectionDetected(String),
    
    #[error("Rate limit exceeded: {0}")]
    RateLimitExceeded(String),
    
    #[error("Audit error: {0}")]
    AuditError(String),
    
    #[error("Invalid request: {0}")]
    InvalidRequest(String),
}

/// Governor configuration
#[derive(Debug, Clone)]
pub struct GovernorConfig {
    /// Listen address for gRPC server
    pub listen_address: String,
    
    /// Maximum concurrent executions
    pub max_concurrent: usize,
    
    /// Default timeout in milliseconds
    pub default_timeout_ms: u64,
    
    /// Enable audit logging
    pub audit_enabled: bool,
    
    /// Audit log path
    pub audit_log_path: String,
}

impl Default for GovernorConfig {
    fn default() -> Self {
        Self {
            listen_address: "0.0.0.0:50051".to_string(),
            max_concurrent: 100,
            default_timeout_ms: 30000,
            audit_enabled: true,
            audit_log_path: "./audit.log".to_string(),
        }
    }
}

/// Safety Governor - the security enforcement layer
pub struct SafetyGovernor {
    config: GovernorConfig,
    permissions: permissions::PermissionManager,
    sandbox: sandbox::SandboxExecutor,
    audit: audit::AuditTrail,
    filters: filters::FilterChain,
}

impl SafetyGovernor {
    /// Create a new Safety Governor
    pub fn new(config: GovernorConfig) -> Result<Self> {
        let permissions = permissions::PermissionManager::new()?;
        let sandbox = sandbox::SandboxExecutor::new()?;
        let audit = audit::AuditTrail::new(&config.audit_log_path)?;
        let filters = filters::FilterChain::default();
        
        Ok(Self {
            config,
            permissions,
            sandbox,
            audit,
            filters,
        })
    }
    
    /// Check if an action is permitted
    pub fn check_permission(&self, agent_id: &str, action: &str, resource: &str) -> Result<bool, GovernorError> {
        self.permissions.check(agent_id, action, resource)
    }
    
    /// Execute a command in the sandbox
    pub async fn execute_sandboxed(
        &self,
        command: &str,
        options: sandbox::ExecutionOptions,
    ) -> Result<sandbox::ExecutionResult, GovernorError> {
        // Check for injection attempts
        if let Some(detection) = self.filters.scan(command) {
            return Err(GovernorError::InjectionDetected(detection));
        }
        
        // Execute in sandbox
        let result = self.sandbox.execute(command, options).await
            .map_err(|e| GovernorError::SandboxError(e.to_string()))?;
        
        // Log to audit trail
        if self.config.audit_enabled {
            self.audit.log_execution(command, &result)?;
        }
        
        Ok(result)
    }
    
    /// Get the audit trail
    pub fn get_audit_trail(&self) -> &audit::AuditTrail {
        &self.audit
    }
    
    /// Get permission manager
    pub fn get_permissions(&self) -> &permissions::PermissionManager {
        &self.permissions
    }
    
    /// Get sandbox executor
    pub fn get_sandbox(&self) -> &sandbox::SandboxExecutor {
        &self.sandbox
    }
}

/// Re-exports for convenience
pub use audit::{AuditEntry, AuditTrail};
pub use filters::{DetectionResult, FilterChain};
pub use permissions::{Permission, PermissionManager};
pub use sandbox::{ExecutionOptions, ExecutionResult, SandboxExecutor};

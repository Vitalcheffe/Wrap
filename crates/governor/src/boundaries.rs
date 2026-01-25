//! Boundary system for resource limits

use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use sysinfo::{System, SystemExt};
use chrono::{DateTime, Utc};

/// Resource boundary configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Boundary {
    /// Memory limit in bytes
    pub memory_limit: usize,
    /// CPU limit as percentage (0-100)
    pub cpu_limit: u8,
    /// Execution timeout in milliseconds
    pub timeout_ms: u64,
    /// Maximum open file descriptors
    pub max_open_files: usize,
    /// Maximum file size in bytes
    pub max_file_size: usize,
    /// Maximum total storage in bytes
    pub max_storage: usize,
    /// Network enabled
    pub network_enabled: bool,
    /// Allowed network hosts
    pub allowed_hosts: Vec<String>,
    /// Maximum concurrent operations
    pub max_concurrent_ops: usize,
    /// Maximum recursion depth
    pub max_recursion_depth: usize,
}

impl Default for Boundary {
    fn default() -> Self {
        Self {
            memory_limit: 512 * 1024 * 1024,
            cpu_limit: 50,
            timeout_ms: 60_000,
            max_open_files: 100,
            max_file_size: 10 * 1024 * 1024,
            max_storage: 100 * 1024 * 1024,
            network_enabled: false,
            allowed_hosts: vec![],
            max_concurrent_ops: 10,
            max_recursion_depth: 10,
        }
    }
}

impl Boundary {
    /// Check current resource usage against limits
    pub fn check_resources(&self) -> Result<(), BoundaryViolation> {
        let usage = self.current_usage();

        if usage.memory_used > self.memory_limit {
            return Err(BoundaryViolation::Memory {
                used: usage.memory_used,
                limit: self.memory_limit,
            });
        }

        if usage.cpu_percent > self.cpu_limit as f32 {
            return Err(BoundaryViolation::Cpu {
                used: usage.cpu_percent,
                limit: self.cpu_limit,
            });
        }

        Ok(())
    }

    /// Get current resource usage
    pub fn current_usage(&self) -> ResourceUsage {
        let mut sys = System::new_all();
        sys.refresh_all();

        ResourceUsage {
            memory_used: sys.used_memory() as usize,
            memory_limit: self.memory_limit,
            cpu_percent: sys.global_cpu_info().cpu_usage(),
        }
    }

    /// Check if a host is allowed
    pub fn is_host_allowed(&self, host: &str) -> bool {
        if !self.network_enabled {
            return false;
        }

        if self.allowed_hosts.is_empty() {
            return false;
        }

        for pattern in &self.allowed_hosts {
            if pattern == "*" || pattern == host {
                return true;
            }
            if pattern.starts_with("*.") {
                let suffix = &pattern[2..];
                if host.ends_with(suffix) || host == suffix {
                    return true;
                }
            }
        }

        false
    }
}

/// Resource usage information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub memory_used: usize,
    pub memory_limit: usize,
    pub cpu_percent: f32,
}

impl ResourceUsage {
    pub fn memory_percent(&self) -> f32 {
        if self.memory_limit == 0 { 0.0 } else { (self.memory_used as f64 / self.memory_limit as f64 * 100.0) as f32 }
    }

    pub fn is_exceeded(&self) -> bool {
        self.memory_used > self.memory_limit || self.cpu_percent > 50.0
    }
}

/// Boundary violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BoundaryViolation {
    Memory { used: usize, limit: usize },
    Cpu { used: f32, limit: u8 },
    Timeout { duration_ms: u64, limit_ms: u64 },
    FileSize { size: usize, limit: usize },
    Storage { used: usize, limit: usize },
    Network { host: String },
    Recursion { depth: usize, limit: usize },
}

impl std::fmt::Display for BoundaryViolation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Memory { used, limit } => write!(f, "Memory limit exceeded: {} > {}", used, limit),
            Self::Cpu { used, limit } => write!(f, "CPU limit exceeded: {:.1}% > {}%", used, limit),
            Self::Timeout { duration_ms, limit_ms } => write!(f, "Timeout: {}ms > {}ms", duration_ms, limit_ms),
            Self::FileSize { size, limit } => write!(f, "File size exceeded: {} > {}", size, limit),
            Self::Storage { used, limit } => write!(f, "Storage exceeded: {} > {}", used, limit),
            Self::Network { host } => write!(f, "Network access denied: {}", host),
            Self::Recursion { depth, limit } => write!(f, "Recursion depth exceeded: {} > {}", depth, limit),
        }
    }
}

impl std::error::Error for BoundaryViolation {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_boundary_default() {
        let b = Boundary::default();
        assert_eq!(b.memory_limit, 512 * 1024 * 1024);
        assert!(!b.network_enabled);
    }

    #[test]
    fn test_boundary_host_check() {
        let mut b = Boundary::default();
        b.network_enabled = true;
        b.allowed_hosts = vec!["example.com".to_string(), "*.test.com".to_string()];

        assert!(b.is_host_allowed("example.com"));
        assert!(!b.is_host_allowed("other.com"));
        assert!(b.is_host_allowed("sub.test.com"));
    }
}

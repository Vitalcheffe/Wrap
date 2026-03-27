//! Permission management for the Safety Governor

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

/// A permission grant
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    /// Permission name
    pub name: String,
    /// Allowed resources (glob patterns)
    pub resources: Vec<String>,
    /// Denied resources (glob patterns)
    pub denied: Vec<String>,
    /// Rate limit (requests per second)
    pub rate_limit: Option<f64>,
    /// Expiration timestamp
    pub expires_at: Option<u64>,
}

/// Permission manager
pub struct PermissionManager {
    /// Agent permissions
    agent_permissions: HashMap<String, Vec<Permission>>,
    /// Global permissions
    global_permissions: Vec<Permission>,
    /// Blocked actions
    blocked_actions: HashSet<String>,
}

impl PermissionManager {
    /// Create a new permission manager
    pub fn new() -> Result<Self> {
        Ok(Self {
            agent_permissions: HashMap::new(),
            global_permissions: Self::default_global_permissions(),
            blocked_actions: Self::default_blocked_actions(),
        })
    }
    
    /// Load permissions from file
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = fs::read_to_string(path)?;
        let permissions: HashMap<String, Vec<Permission>> = serde_json::from_str(&content)?;
        
        Ok(Self {
            agent_permissions: permissions,
            global_permissions: Self::default_global_permissions(),
            blocked_actions: Self::default_blocked_actions(),
        })
    }
    
    /// Check if an action is permitted
    pub fn check(&self, agent_id: &str, action: &str, resource: &str) -> Result<bool, super::GovernorError> {
        // Check blocked actions first
        if self.blocked_actions.contains(action) {
            return Err(super::GovernorError::PermissionDenied(
                format!("Action '{}' is globally blocked", action)
            ));
        }
        
        // Check agent-specific permissions
        if let Some(perms) = self.agent_permissions.get(agent_id) {
            for perm in perms {
                if self.matches_permission(perm, action, resource) {
                    return Ok(true);
                }
            }
        }
        
        // Check global permissions
        for perm in &self.global_permissions {
            if self.matches_permission(perm, action, resource) {
                return Ok(true);
            }
        }
        
        Err(super::GovernorError::PermissionDenied(
            format!("No permission for action '{}' on resource '{}'", action, resource)
        ))
    }
    
    /// Grant permission to an agent
    pub fn grant(&mut self, agent_id: String, permission: Permission) {
        self.agent_permissions
            .entry(agent_id)
            .or_insert_with(Vec::new)
            .push(permission);
    }
    
    /// Revoke permission from an agent
    pub fn revoke(&mut self, agent_id: &str, permission_name: &str) -> bool {
        if let Some(perms) = self.agent_permissions.get_mut(agent_id) {
            let initial_len = perms.len();
            perms.retain(|p| p.name != permission_name);
            perms.len() != initial_len
        } else {
            false
        }
    }
    
    /// List permissions for an agent
    pub fn list(&self, agent_id: &str) -> Vec<&Permission> {
        let mut result = Vec::new();
        
        if let Some(perms) = self.agent_permissions.get(agent_id) {
            result.extend(perms.iter());
        }
        
        result.extend(self.global_permissions.iter());
        result
    }
    
    fn matches_permission(&self, perm: &Permission, action: &str, resource: &str) -> bool {
        // Check if action matches permission name
        if perm.name != action && perm.name != "*" {
            return false;
        }
        
        // Check denied resources
        for pattern in &perm.denied {
            if self.matches_pattern(pattern, resource) {
                return false;
            }
        }
        
        // Check allowed resources
        if perm.resources.is_empty() {
            return true;
        }
        
        for pattern in &perm.resources {
            if self.matches_pattern(pattern, resource) {
                return true;
            }
        }
        
        false
    }
    
    fn matches_pattern(&self, pattern: &str, value: &str) -> bool {
        if pattern == "*" {
            return true;
        }
        
        if pattern.ends_with('*') {
            return value.starts_with(&pattern[..pattern.len() - 1]);
        }
        
        if pattern.starts_with('*') {
            return value.ends_with(&pattern[1..]);
        }
        
        pattern == value
    }
    
    fn default_global_permissions() -> Vec<Permission> {
        vec![
            Permission {
                name: "fs.read".to_string(),
                resources: vec!["/workspace/*".to_string()],
                denied: vec!["**/.env".to_string()],
                rate_limit: Some(100.0),
                expires_at: None,
            },
            Permission {
                name: "fs.write".to_string(),
                resources: vec!["/workspace/*".to_string()],
                denied: vec!["**/.env".to_string()],
                rate_limit: Some(50.0),
                expires_at: None,
            },
            Permission {
                name: "shell.execute".to_string(),
                resources: vec!["*".to_string()],
                denied: vec!["rm -rf /*".to_string(), "sudo *".to_string()],
                rate_limit: Some(10.0),
                expires_at: None,
            },
            Permission {
                name: "network.http".to_string(),
                resources: vec!["https://*".to_string()],
                denied: vec!["http://*".to_string()],
                rate_limit: Some(100.0),
                expires_at: None,
            },
        ]
    }
    
    fn default_blocked_actions() -> HashSet<String> {
        let mut blocked = HashSet::new();
        blocked.insert("system.shutdown".to_string());
        blocked.insert("system.reboot".to_string());
        blocked.insert("shell.execute:rm -rf /".to_string());
        blocked.insert("shell.execute:mkfs".to_string());
        blocked
    }
}

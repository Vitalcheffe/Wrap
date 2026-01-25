//! Permission system for WRAP Governor

use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// A permission that can be granted or denied
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Permission {
    /// Read a file at the given path
    FileRead(String),
    /// Write to a file at the given path
    FileWrite(String),
    /// Delete a file at the given path
    FileDelete(String),
    /// Execute a shell command
    ShellExecute(String),
    /// Make an HTTP request to a URL
    HttpRequest(String),
    /// Connect to a WebSocket
    WebSocketConnect(String),
    /// Read an environment variable
    EnvRead(String),
    /// Write an environment variable
    EnvWrite(String),
    /// Generic permission with string identifier
    Custom(String),
}

impl Permission {
    /// Check if this permission matches a pattern
    pub fn matches(&self, pattern: &Permission) -> bool {
        match (self, pattern) {
            (Permission::FileRead(a), Permission::FileRead(b)) => path_matches(a, b),
            (Permission::FileWrite(a), Permission::FileWrite(b)) => path_matches(a, b),
            (Permission::FileDelete(a), Permission::FileDelete(b)) => path_matches(a, b),
            (Permission::ShellExecute(a), Permission::ShellExecute(b)) => glob_match(a, b),
            (Permission::HttpRequest(a), Permission::HttpRequest(b)) => url_matches(a, b),
            (Permission::WebSocketConnect(a), Permission::WebSocketConnect(b)) => url_matches(a, b),
            (Permission::EnvRead(a), Permission::EnvRead(b)) => glob_match(a, b),
            (Permission::EnvWrite(a), Permission::EnvWrite(b)) => glob_match(a, b),
            (Permission::Custom(a), Permission::Custom(b)) => a == b,
            _ => false,
        }
    }

    /// Get the category of this permission
    pub fn category(&self) -> &'static str {
        match self {
            Permission::FileRead(_) | Permission::FileWrite(_) | Permission::FileDelete(_) => "filesystem",
            Permission::ShellExecute(_) => "execution",
            Permission::HttpRequest(_) | Permission::WebSocketConnect(_) => "network",
            Permission::EnvRead(_) | Permission::EnvWrite(_) => "environment",
            Permission::Custom(_) => "custom",
        }
    }
}

/// Check if a path matches a pattern
fn path_matches(path: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern.ends_with("/**") {
        let prefix = &pattern[..pattern.len() - 3];
        return path.starts_with(prefix);
    }
    if pattern.ends_with("/*") {
        let prefix = &pattern[..pattern.len() - 2];
        if !path.starts_with(prefix) {
            return false;
        }
        let rest = &path[prefix.len()..];
        return !rest.contains('/');
    }
    glob_match(path, pattern)
}

/// Simple glob matching
fn glob_match(text: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let text_chars: Vec<char> = text.chars().collect();
    let pattern_chars: Vec<char> = pattern.chars().collect();
    let mut dp = vec![vec![false; pattern_chars.len() + 1]; text_chars.len() + 1];
    dp[0][0] = true;

    for j in 1..=pattern_chars.len() {
        if pattern_chars[j - 1] == '*' {
            dp[0][j] = dp[0][j - 1];
        }
    }

    for i in 1..=text_chars.len() {
        for j in 1..=pattern_chars.len() {
            if pattern_chars[j - 1] == '*' {
                dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
            } else if pattern_chars[j - 1] == '?' || pattern_chars[j - 1] == text_chars[i - 1] {
                dp[i][j] = dp[i - 1][j - 1];
            }
        }
    }

    dp[text_chars.len()][pattern_chars.len()]
}

/// Check if a URL matches a pattern
fn url_matches(url: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let url_lower = url.to_lowercase();
    let pattern_lower = pattern.to_lowercase();
    glob_match(&url_lower, &pattern_lower)
}

/// A set of permissions with grant/deny semantics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionSet {
    /// Permissions that are granted
    granted: HashSet<Permission>,
    /// Permissions that are explicitly denied (takes precedence)
    denied: HashSet<Permission>,
    /// Conditional grants with constraints
    conditional: HashMap<Permission, PermissionCondition>,
    /// Default allow policy
    default_allow: bool,
}

impl Default for PermissionSet {
    fn default() -> Self {
        Self {
            granted: HashSet::new(),
            denied: HashSet::new(),
            conditional: HashMap::new(),
            default_allow: false,
        }
    }
}

impl PermissionSet {
    /// Grant a permission
    pub fn grant(&mut self, permission: Permission) {
        self.denied.remove(&permission);
        self.granted.insert(permission);
    }

    /// Deny a permission
    pub fn deny(&mut self, permission: Permission) {
        self.granted.remove(&permission);
        self.denied.insert(permission);
    }

    /// Grant with conditions
    pub fn grant_conditional(&mut self, permission: Permission, condition: PermissionCondition) {
        self.conditional.insert(permission, condition);
    }

    /// Check if a permission is allowed
    pub fn check(&self, permission: &Permission) -> bool {
        // Check explicit deny first
        for denied in &self.denied {
            if permission.matches(denied) || denied.matches(permission) {
                return false;
            }
        }

        // Check explicit grant
        for granted in &self.granted {
            if permission.matches(granted) || granted.matches(permission) {
                return true;
            }
        }

        // Check conditional grants
        for (cond_perm, condition) in &self.conditional {
            if permission.matches(cond_perm) || cond_perm.matches(permission) {
                if condition.evaluate() {
                    return true;
                }
            }
        }

        self.default_allow
    }
}

/// Condition for conditional permission grants
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionCondition {
    /// Time window when permission is valid
    pub time_window: Option<TimeWindow>,
    /// Maximum number of uses
    pub max_uses: Option<u32>,
    /// Current use count
    pub current_uses: u32,
    /// Additional constraints
    pub constraints: HashMap<String, String>,
}

impl PermissionCondition {
    pub fn new() -> Self {
        Self {
            time_window: None,
            max_uses: None,
            current_uses: 0,
            constraints: HashMap::new(),
        }
    }

    /// Evaluate if the condition is satisfied
    pub fn evaluate(&self) -> bool {
        if let Some(ref window) = self.time_window {
            let now = Utc::now();
            if now < window.start || now > window.end {
                return false;
            }
        }

        if let Some(max) = self.max_uses {
            if self.current_uses >= max {
                return false;
            }
        }

        true
    }
}

impl Default for PermissionCondition {
    fn default() -> Self {
        Self::new()
    }
}

/// Time window for permission validity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeWindow {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_creation() {
        let perm = Permission::FileRead("/tmp/test.txt".to_string());
        assert_eq!(perm.category(), "filesystem");
    }

    #[test]
    fn test_permission_matching() {
        let perm = Permission::FileRead("/tmp/test.txt".to_string());
        let pattern = Permission::FileRead("/tmp/*".to_string());
        assert!(perm.matches(&pattern));
    }

    #[test]
    fn test_permission_set() {
        let mut set = PermissionSet::default();
        set.grant(Permission::FileRead("/tmp/*".to_string()));
        assert!(set.check(&Permission::FileRead("/tmp/test.txt".to_string())));
        assert!(!set.check(&Permission::FileRead("/etc/passwd".to_string())));
    }
}

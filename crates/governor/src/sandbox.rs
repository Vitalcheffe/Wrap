//! Sandbox execution for the Safety Governor

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::{Duration, Instant};

/// Execution options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionOptions {
    /// Working directory
    pub cwd: Option<String>,
    /// Environment variables
    pub env: Option<Vec<(String, String)>>,
    /// Timeout in milliseconds
    pub timeout_ms: Option<u64>,
    /// Capture stdout
    pub capture_stdout: bool,
    /// Capture stderr
    pub capture_stderr: bool,
}

impl Default for ExecutionOptions {
    fn default() -> Self {
        Self {
            cwd: None,
            env: None,
            timeout_ms: Some(30000),
            capture_stdout: true,
            capture_stderr: true,
        }
    }
}

/// Execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    /// Exit code
    pub exit_code: i32,
    /// Standard output
    pub stdout: String,
    /// Standard error
    pub stderr: String,
    /// Execution duration in milliseconds
    pub duration_ms: u64,
    /// Success flag
    pub success: bool,
    /// Resource usage
    pub resource_usage: Option<ResourceUsage>,
}

/// Resource usage statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    /// CPU time in milliseconds
    pub cpu_time_ms: u64,
    /// Peak memory in bytes
    pub peak_memory_bytes: u64,
    /// Bytes read
    pub bytes_read: u64,
    /// Bytes written
    pub bytes_written: u64,
}

/// Sandbox executor
pub struct SandboxExecutor {
    /// Default timeout
    default_timeout: Duration,
    /// Allowed commands
    allowed_commands: Vec<String>,
    /// Denied command patterns
    denied_patterns: Vec<String>,
}

impl SandboxExecutor {
    /// Create a new sandbox executor
    pub fn new() -> Result<Self> {
        Ok(Self {
            default_timeout: Duration::from_secs(30),
            allowed_commands: vec![
                "ls".to_string(),
                "cat".to_string(),
                "echo".to_string(),
                "grep".to_string(),
                "find".to_string(),
                "mkdir".to_string(),
                "touch".to_string(),
                "cp".to_string(),
                "mv".to_string(),
                "head".to_string(),
                "tail".to_string(),
                "wc".to_string(),
            ],
            denied_patterns: vec![
                "rm -rf /".to_string(),
                "sudo".to_string(),
                "mkfs".to_string(),
                "dd if=/dev/zero".to_string(),
                ":(){ :|:& };:".to_string(),
                "chmod -R 777".to_string(),
                "chown -R".to_string(),
            ],
        })
    }
    
    /// Execute a command in the sandbox
    pub async fn execute(
        &self,
        command: &str,
        options: ExecutionOptions,
    ) -> Result<ExecutionResult> {
        // Check if command is allowed
        if !self.is_allowed(command) {
            return Ok(ExecutionResult {
                exit_code: 126,
                stdout: String::new(),
                stderr: "Command not allowed in sandbox".to_string(),
                duration_ms: 0,
                success: false,
                resource_usage: None,
            });
        }
        
        let start = Instant::now();
        let timeout = Duration::from_millis(options.timeout_ms.unwrap_or(30000));
        
        // Parse command
        let parts = shell_words::parse(command)?;
        if parts.is_empty() {
            return Ok(ExecutionResult {
                exit_code: 1,
                stdout: String::new(),
                stderr: "Empty command".to_string(),
                duration_ms: 0,
                success: false,
                resource_usage: None,
            });
        }
        
        let cmd_name = &parts[0];
        let args = &parts[1..];
        
        // Build command
        let mut cmd = Command::new(cmd_name);
        cmd.args(args);
        
        if let Some(ref cwd) = options.cwd {
            cmd.current_dir(cwd);
        }
        
        if let Some(ref env) = options.env {
            for (key, value) in env {
                cmd.env(key, value);
            }
        }
        
        // Execute with timeout
        let output = tokio::time::timeout(timeout, async {
            cmd.output()
        }).await;
        
        let duration_ms = start.elapsed().as_millis() as u64;
        
        match output {
            Ok(Ok(output)) => {
                Ok(ExecutionResult {
                    exit_code: output.status.code().unwrap_or(-1),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    duration_ms,
                    success: output.status.success(),
                    resource_usage: None,
                })
            }
            Ok(Err(e)) => {
                Ok(ExecutionResult {
                    exit_code: 1,
                    stdout: String::new(),
                    stderr: e.to_string(),
                    duration_ms,
                    success: false,
                    resource_usage: None,
                })
            }
            Err(_) => {
                Ok(ExecutionResult {
                    exit_code: 124, // Standard timeout exit code
                    stdout: String::new(),
                    stderr: "Command timed out".to_string(),
                    duration_ms,
                    success: false,
                    resource_usage: None,
                })
            }
        }
    }
    
    /// Check if a command is allowed
    pub fn is_allowed(&self, command: &str) -> bool {
        let lower = command.to_lowercase();
        
        // Check denied patterns
        for pattern in &self.denied_patterns {
            if lower.contains(&pattern.to_lowercase()) {
                return false;
            }
        }
        
        // Get command name
        let cmd_name = command.split_whitespace().next().unwrap_or("");
        
        // Check if command is in allowed list
        self.allowed_commands.iter().any(|c| c == cmd_name)
    }
    
    /// Add an allowed command
    pub fn allow(&mut self, command: &str) {
        if !self.allowed_commands.contains(&command.to_string()) {
            self.allowed_commands.push(command.to_string());
        }
    }
    
    /// Block a command pattern
    pub fn block(&mut self, pattern: &str) {
        if !self.denied_patterns.contains(&pattern.to_string()) {
            self.denied_patterns.push(pattern.to_string());
        }
    }
}

/// Simple shell word parser (minimal implementation)
mod shell_words {
    use anyhow::Result;
    
    pub fn parse(input: &str) -> Result<Vec<String>> {
        let mut result = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        let mut quote_char = ' ';
        let mut escape_next = false;
        
        for c in input.chars() {
            if escape_next {
                current.push(c);
                escape_next = false;
                continue;
            }
            
            match c {
                '\\' => {
                    escape_next = true;
                }
                '"' | '\'' => {
                    if in_quotes {
                        if c == quote_char {
                            in_quotes = false;
                        } else {
                            current.push(c);
                        }
                    } else {
                        in_quotes = true;
                        quote_char = c;
                    }
                }
                ' ' | '\t' => {
                    if in_quotes {
                        current.push(c);
                    } else if !current.is_empty() {
                        result.push(current.clone());
                        current.clear();
                    }
                }
                _ => {
                    current.push(c);
                }
            }
        }
        
        if !current.is_empty() {
            result.push(current);
        }
        
        Ok(result)
    }
}

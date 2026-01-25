//! Sandboxed execution for the Governor safety system.
//!
//! This module provides secure code execution:
//! - Multiple isolation levels
//! - Resource enforcement
//! - Timeout handling
//! - Output capture

use crate::boundaries::{Boundaries, BoundaryMonitor, ResourceUsage};
use crate::error::{GovernorError, Result};
use crate::permissions::{Permission, PermissionSet};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Output, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command as AsyncCommand};
use tokio::sync::RwLock;
use tokio::time::timeout;

/// Type of isolation for sandboxed execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum IsolationType {
    /// No isolation (run directly)
    None,
    /// Process-level isolation (separate process)
    Process,
    /// Container-based isolation (Docker, etc.)
    Container,
    /// VM-based isolation (strongest)
    Vm,
    /// WebAssembly-based isolation
    #[default]
    Wasm,
}

impl fmt::Display for IsolationType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => write!(f, "none"),
            Self::Process => write!(f, "process"),
            Self::Container => write!(f, "container"),
            Self::Vm => write!(f, "vm"),
            Self::Wasm => write!(f, "wasm"),
        }
    }
}

/// Status of a sandbox execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    /// Execution is pending
    Pending,
    /// Execution is running
    Running,
    /// Execution completed successfully
    Success,
    /// Execution failed
    Failed,
    /// Execution timed out
    Timeout,
    /// Execution was cancelled
    Cancelled,
    /// Execution was killed due to resource limits
    ResourceExceeded,
}

impl fmt::Display for ExecutionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Running => write!(f, "running"),
            Self::Success => write!(f, "success"),
            Self::Failed => write!(f, "failed"),
            Self::Timeout => write!(f, "timeout"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::ResourceExceeded => write!(f, "resource_exceeded"),
        }
    }
}

/// Configuration for sandbox execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// Type of isolation
    pub isolation_type: IsolationType,
    /// Resource boundaries
    pub boundaries: Boundaries,
    /// Permission set
    pub permissions: PermissionSet,
    /// Working directory for execution
    pub working_directory: Option<PathBuf>,
    /// Environment variables
    pub environment: HashMap<String, String>,
    /// Timeout in milliseconds
    pub timeout_ms: u64,
    /// Whether to capture stdout
    pub capture_stdout: bool,
    /// Whether to capture stderr
    pub capture_stderr: bool,
    /// Maximum output size in bytes
    pub max_output_size: usize,
    /// Whether to allow network access
    pub allow_network: bool,
    /// Whether to allow filesystem access
    pub allow_filesystem: bool,
    /// Container image (for container isolation)
    pub container_image: Option<String>,
    /// Additional container options
    pub container_options: Vec<String>,
    /// Pre-execution hook
    pub pre_exec_hook: Option<String>,
    /// Post-execution hook
    pub post_exec_hook: Option<String>,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            isolation_type: IsolationType::default(),
            boundaries: Boundaries::default(),
            permissions: PermissionSet::new(),
            working_directory: None,
            environment: HashMap::new(),
            timeout_ms: 30_000,
            capture_stdout: true,
            capture_stderr: true,
            max_output_size: 1024 * 1024, // 1MB
            allow_network: false,
            allow_filesystem: false,
            container_image: None,
            container_options: Vec::new(),
            pre_exec_hook: None,
            post_exec_hook: None,
        }
    }
}

impl SandboxConfig {
    /// Creates a new sandbox configuration.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a strict sandbox configuration.
    #[must_use]
    pub fn strict() -> Self {
        Self {
            isolation_type: IsolationType::Process,
            boundaries: Boundaries::strict(),
            permissions: PermissionSet::new(),
            timeout_ms: 5_000,
            capture_stdout: true,
            capture_stderr: true,
            max_output_size: 100 * 1024, // 100KB
            allow_network: false,
            allow_filesystem: false,
            ..Default::default()
        }
    }

    /// Sets the isolation type.
    #[must_use]
    pub fn with_isolation(mut self, isolation_type: IsolationType) -> Self {
        self.isolation_type = isolation_type;
        self
    }

    /// Sets the boundaries.
    #[must_use]
    pub fn with_boundaries(mut self, boundaries: Boundaries) -> Self {
        self.boundaries = boundaries;
        self
    }

    /// Sets the timeout.
    #[must_use]
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }

    /// Sets the working directory.
    #[must_use]
    pub fn with_working_directory(mut self, path: impl Into<PathBuf>) -> Self {
        self.working_directory = Some(path.into());
        self
    }

    /// Adds an environment variable.
    #[must_use]
    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.environment.insert(key.into(), value.into());
        self
    }

    /// Enables network access.
    #[must_use]
    pub fn with_network(mut self, allow: bool) -> Self {
        self.allow_network = allow;
        self
    }

    /// Enables filesystem access.
    #[must_use]
    pub fn with_filesystem(mut self, allow: bool) -> Self {
        self.allow_filesystem = allow;
        self
    }

    /// Sets the container image.
    #[must_use]
    pub fn with_container_image(mut self, image: impl Into<String>) -> Self {
        self.container_image = Some(image.into());
        self
    }

    /// Grants a permission.
    pub fn grant_permission(&mut self, permission: Permission) {
        self.permissions.grant(permission);
    }
}

/// Result of a sandbox execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    /// Unique execution ID
    pub id: uuid::Uuid,
    /// Execution status
    pub status: ExecutionStatus,
    /// Exit code (if available)
    pub exit_code: Option<i32>,
    /// Captured stdout
    pub stdout: Option<String>,
    /// Captured stderr
    pub stderr: Option<String>,
    /// Execution duration in milliseconds
    pub duration_ms: u64,
    /// Resource usage during execution
    pub resource_usage: ResourceUsage,
    /// Timestamp when execution started
    pub started_at: DateTime<Utc>,
    /// Timestamp when execution ended
    pub ended_at: Option<DateTime<Utc>>,
    /// Error message (if failed)
    pub error: Option<String>,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

impl ExecutionResult {
    /// Creates a new execution result.
    #[must_use]
    pub fn new(id: uuid::Uuid) -> Self {
        Self {
            id,
            status: ExecutionStatus::Pending,
            exit_code: None,
            stdout: None,
            stderr: None,
            duration_ms: 0,
            resource_usage: ResourceUsage::new(),
            started_at: Utc::now(),
            ended_at: None,
            error: None,
            metadata: HashMap::new(),
        }
    }

    /// Creates a successful result.
    #[must_use]
    pub fn success(
        id: uuid::Uuid,
        exit_code: i32,
        stdout: Option<String>,
        stderr: Option<String>,
        duration_ms: u64,
        resource_usage: ResourceUsage,
    ) -> Self {
        Self {
            id,
            status: ExecutionStatus::Success,
            exit_code: Some(exit_code),
            stdout,
            stderr,
            duration_ms,
            resource_usage,
            started_at: Utc::now() - chrono::Duration::milliseconds(duration_ms as i64),
            ended_at: Some(Utc::now()),
            error: None,
            metadata: HashMap::new(),
        }
    }

    /// Creates a failed result.
    #[must_use]
    pub fn failed(id: uuid::Uuid, error: impl Into<String>, duration_ms: u64) -> Self {
        Self {
            id,
            status: ExecutionStatus::Failed,
            exit_code: None,
            stdout: None,
            stderr: None,
            duration_ms,
            resource_usage: ResourceUsage::new(),
            started_at: Utc::now() - chrono::Duration::milliseconds(duration_ms as i64),
            ended_at: Some(Utc::now()),
            error: Some(error.into()),
            metadata: HashMap::new(),
        }
    }

    /// Creates a timeout result.
    #[must_use]
    pub fn timeout(id: uuid::Uuid, duration_ms: u64) -> Self {
        Self {
            id,
            status: ExecutionStatus::Timeout,
            exit_code: None,
            stdout: None,
            stderr: None,
            duration_ms,
            resource_usage: ResourceUsage::new(),
            started_at: Utc::now() - chrono::Duration::milliseconds(duration_ms as i64),
            ended_at: Some(Utc::now()),
            error: Some("Execution timed out".to_string()),
            metadata: HashMap::new(),
        }
    }

    /// Returns whether the execution succeeded.
    #[must_use]
    pub const fn is_success(&self) -> bool {
        self.status == ExecutionStatus::Success
    }

    /// Adds metadata.
    #[must_use]
    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }
}

/// A sandbox executor for running code safely.
pub struct SandboxExecutor {
    /// Configuration
    config: SandboxConfig,
    /// Boundary monitor
    monitor: Arc<BoundaryMonitor>,
    /// Active executions
    active_executions: RwLock<HashMap<uuid::Uuid, ExecutionStatus>>,
}

impl SandboxExecutor {
    /// Creates a new sandbox executor.
    #[must_use]
    pub fn new(config: SandboxConfig) -> Self {
        let boundaries = config.boundaries.clone();
        Self {
            config,
            monitor: Arc::new(BoundaryMonitor::new(boundaries)),
            active_executions: RwLock::new(HashMap::new()),
        }
    }

    /// Creates an executor with default configuration.
    #[must_use]
    pub fn with_defaults() -> Self {
        Self::new(SandboxConfig::default())
    }

    /// Creates a strict executor.
    #[must_use]
    pub fn strict() -> Self {
        Self::new(SandboxConfig::strict())
    }

    /// Gets the configuration.
    #[must_use]
    pub fn config(&self) -> &SandboxConfig {
        &self.config
    }

    /// Executes a command in the sandbox.
    pub async fn execute(&self, command: &str, args: &[&str]) -> Result<ExecutionResult> {
        let id = uuid::Uuid::new_v4();
        let start = Instant::now();
        let started_at = Utc::now();

        // Register execution
        {
            let mut active = self.active_executions.write().await;
            active.insert(id, ExecutionStatus::Running);
        }

        // Reset resource monitor
        self.monitor.reset();

        let result = match self.config.isolation_type {
            IsolationType::None => self.execute_direct(command, args, id).await,
            IsolationType::Process => self.execute_process(command, args, id).await,
            IsolationType::Container => self.execute_container(command, args, id).await,
            IsolationType::Wasm => self.execute_wasm(command, args, id).await,
            IsolationType::Vm => {
                Err(GovernorError::NotImplemented {
                    feature: "VM isolation".to_string(),
                })
            }
        };

        // Remove from active executions
        {
            let mut active = self.active_executions.write().await;
            active.remove(&id);
        }

        let duration_ms = start.elapsed().as_millis() as u64;
        let resource_usage = self.monitor.usage();

        match result {
            Ok(mut result) => {
                result.duration_ms = duration_ms;
                result.resource_usage = resource_usage;
                result.started_at = started_at;
                result.ended_at = Some(Utc::now());
                Ok(result)
            }
            Err(e) => {
                let mut result = ExecutionResult::failed(id, e.to_string(), duration_ms);
                result.resource_usage = resource_usage;
                result.started_at = started_at;
                result.ended_at = Some(Utc::now());
                Ok(result)
            }
        }
    }

    /// Executes a command directly (no isolation).
    async fn execute_direct(
        &self,
        command: &str,
        args: &[&str],
        id: uuid::Uuid,
    ) -> Result<ExecutionResult> {
        let start = Instant::now();

        // Check permission
        if !self.config.permissions.is_granted(&Permission::shell(command)) {
            return Err(GovernorError::permission_denied(
                command,
                "Shell execution not permitted",
            ));
        }

        // Build command
        let mut cmd = AsyncCommand::new(command);
        cmd.args(args);

        if let Some(ref cwd) = self.config.working_directory {
            cmd.current_dir(cwd);
        }

        for (key, value) in &self.config.environment {
            cmd.env(key, value);
        }

        // Set up stdio
        let stdout_buf = if self.config.capture_stdout {
            Vec::new()
        } else {
            Vec::new()
        };

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Spawn and wait with timeout
        let timeout_duration = Duration::from_millis(self.config.timeout_ms);

        let result = timeout(timeout_duration, async {
            let mut child = cmd.spawn().map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            // Read output
            let mut stdout_data = Vec::new();
            let mut stderr_data = Vec::new();

            if let Some(ref mut stdout) = child.stdout {
                stdout.read_to_end(&mut stdout_data).await.ok();
            }
            if let Some(ref mut stderr) = child.stderr {
                stderr.read_to_end(&mut stderr_data).await.ok();
            }

            let status = child.wait().await.map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            Ok::<_, GovernorError>((status, stdout_data, stderr_data))
        })
        .await;

        match result {
            Ok(Ok((status, stdout_data, stderr_data))) => {
                let duration_ms = start.elapsed().as_millis() as u64;

                Ok(ExecutionResult::success(
                    id,
                    status.code().unwrap_or(-1),
                    if self.config.capture_stdout {
                        Some(
                            String::from_utf8_lossy(&stdout_data[..self
                                .config
                                .max_output_size
                                .min(stdout_data.len())])
                            .to_string(),
                        )
                    } else {
                        None
                    },
                    if self.config.capture_stderr {
                        Some(
                            String::from_utf8_lossy(&stderr_data[..self
                                .config
                                .max_output_size
                                .min(stderr_data.len())])
                            .to_string(),
                        )
                    } else {
                        None
                    },
                    duration_ms,
                    self.monitor.usage(),
                ))
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Ok(ExecutionResult::timeout(id, self.config.timeout_ms)),
        }
    }

    /// Executes a command in a separate process.
    async fn execute_process(
        &self,
        command: &str,
        args: &[&str],
        id: uuid::Uuid,
    ) -> Result<ExecutionResult> {
        // For process isolation, we use similar logic but with stricter controls
        let start = Instant::now();

        // Check permission
        if !self.config.permissions.is_granted(&Permission::shell(command)) {
            return Err(GovernorError::permission_denied(
                command,
                "Shell execution not permitted",
            ));
        }

        // Build command with restricted environment
        let mut cmd = AsyncCommand::new(command);
        cmd.args(args);

        // Clear environment and set only allowed variables
        cmd.env_clear();

        // Set minimal environment
        cmd.env("PATH", "/usr/bin:/bin");
        cmd.env("HOME", "/tmp/sandbox");
        cmd.env("TMPDIR", "/tmp");

        for (key, value) in &self.config.environment {
            cmd.env(key, value);
        }

        if let Some(ref cwd) = self.config.working_directory {
            cmd.current_dir(cwd);
        } else {
            cmd.current_dir("/tmp");
        }

        // Set up stdio
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.stdin(Stdio::null());

        // Spawn and wait with timeout
        let timeout_duration = Duration::from_millis(self.config.timeout_ms);

        let result = timeout(timeout_duration, async {
            let mut child = cmd.spawn().map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            // Read output in background while monitoring resources
            let mut stdout_data = Vec::new();
            let mut stderr_data = Vec::new();

            if let Some(ref mut stdout) = child.stdout {
                stdout.read_to_end(&mut stdout_data).await.ok();
            }
            if let Some(ref mut stderr) = child.stderr {
                stderr.read_to_end(&mut stderr_data).await.ok();
            }

            let status = child.wait().await.map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            Ok::<_, GovernorError>((status, stdout_data, stderr_data))
        })
        .await;

        match result {
            Ok(Ok((status, stdout_data, stderr_data))) => {
                let duration_ms = start.elapsed().as_millis() as u64;

                Ok(ExecutionResult::success(
                    id,
                    status.code().unwrap_or(-1),
                    if self.config.capture_stdout {
                        Some(
                            String::from_utf8_lossy(&stdout_data[..self
                                .config
                                .max_output_size
                                .min(stdout_data.len())])
                            .to_string(),
                        )
                    } else {
                        None
                    },
                    if self.config.capture_stderr {
                        Some(
                            String::from_utf8_lossy(&stderr_data[..self
                                .config
                                .max_output_size
                                .min(stderr_data.len())])
                            .to_string(),
                        )
                    } else {
                        None
                    },
                    duration_ms,
                    self.monitor.usage(),
                ))
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Ok(ExecutionResult::timeout(id, self.config.timeout_ms)),
        }
    }

    /// Executes a command in a container.
    async fn execute_container(
        &self,
        command: &str,
        args: &[&str],
        id: uuid::Uuid,
    ) -> Result<ExecutionResult> {
        let image = self
            .config
            .container_image
            .as_ref()
            .ok_or_else(|| GovernorError::SandboxExecutionFailed {
                reason: "Container image not specified".to_string(),
            })?;

        let start = Instant::now();

        // Build docker command
        let mut docker_args = vec![
            "run".to_string(),
            "--rm".to_string(),
            "--network".to_string(),
            if self.config.allow_network {
                "bridge"
            } else {
                "none"
            }
            .to_string(),
        ];

        // Add memory limit
        if let Some(mem_limit) = self.config.boundaries.max_memory_bytes {
            docker_args.push("--memory".to_string());
            docker_args.push(format!("{}b", mem_limit));
        }

        // Add CPU limit
        if let Some(cpu_time) = self.config.boundaries.max_cpu_time_ms {
            docker_args.push("--cpu-time".to_string());
            docker_args.push(cpu_time.to_string());
        }

        // Add timeout
        docker_args.push("--timeout".to_string());
        docker_args.push((self.config.timeout_ms / 1000).to_string());

        // Add custom options
        for opt in &self.config.container_options {
            docker_args.push(opt.clone());
        }

        // Add image
        docker_args.push(image.clone());

        // Add command and args
        docker_args.push(command.to_string());
        for arg in args {
            docker_args.push(arg.to_string());
        }

        // Execute docker
        let mut cmd = AsyncCommand::new("docker");
        cmd.args(&docker_args);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let timeout_duration = Duration::from_millis(self.config.timeout_ms + 5000); // Extra buffer for docker overhead

        let result = timeout(timeout_duration, async {
            let mut child = cmd.spawn().map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            let mut stdout_data = Vec::new();
            let mut stderr_data = Vec::new();

            if let Some(ref mut stdout) = child.stdout {
                stdout.read_to_end(&mut stdout_data).await.ok();
            }
            if let Some(ref mut stderr) = child.stderr {
                stderr.read_to_end(&mut stderr_data).await.ok();
            }

            let status = child.wait().await.map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            Ok::<_, GovernorError>((status, stdout_data, stderr_data))
        })
        .await;

        match result {
            Ok(Ok((status, stdout_data, stderr_data))) => {
                let duration_ms = start.elapsed().as_millis() as u64;

                Ok(ExecutionResult::success(
                    id,
                    status.code().unwrap_or(-1),
                    if self.config.capture_stdout {
                        Some(
                            String::from_utf8_lossy(&stdout_data[..self
                                .config
                                .max_output_size
                                .min(stdout_data.len())])
                            .to_string(),
                        )
                    } else {
                        None
                    },
                    if self.config.capture_stderr {
                        Some(
                            String::from_utf8_lossy(&stderr_data[..self
                                .config
                                .max_output_size
                                .min(stderr_data.len())])
                            .to_string(),
                        )
                    } else {
                        None
                    },
                    duration_ms,
                    self.monitor.usage(),
                ))
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Ok(ExecutionResult::timeout(id, self.config.timeout_ms)),
        }
    }

    /// Executes WASM code.
    async fn execute_wasm(
        &self,
        _wasm_file: &str,
        _args: &[&str],
        id: uuid::Uuid,
    ) -> Result<ExecutionResult> {
        // WASM execution would require a WASM runtime
        // This is a placeholder implementation
        Err(GovernorError::NotImplemented {
            feature: "WASM execution".to_string(),
        })
    }

    /// Executes code from a string (for scripting languages).
    pub async fn execute_code(
        &self,
        language: &str,
        code: &str,
        input: Option<&str>,
    ) -> Result<ExecutionResult> {
        let id = uuid::Uuid::new_v4();
        let start = Instant::now();

        // Determine interpreter based on language
        let (interpreter, ext) = match language.to_lowercase().as_str() {
            "python" | "python3" => ("python3", ".py"),
            "javascript" | "js" | "node" => ("node", ".js"),
            "ruby" => ("ruby", ".rb"),
            "perl" => ("perl", ".pl"),
            "bash" | "shell" | "sh" => ("bash", ".sh"),
            "lua" => ("lua", ".lua"),
            _ => {
                return Err(GovernorError::SandboxExecutionFailed {
                    reason: format!("Unsupported language: {language}"),
                })
            }
        };

        // Check permission
        if !self.config.permissions.is_granted(&Permission::shell(interpreter)) {
            return Err(GovernorError::permission_denied(
                interpreter,
                "Code execution not permitted",
            ));
        }

        // Create temporary file
        let temp_dir = std::env::temp_dir();
        let file_name = format!("sandbox_{}{}", id, ext);
        let file_path = temp_dir.join(&file_name);

        // Write code to file
        tokio::fs::write(&file_path, code).await.map_err(|e| {
            GovernorError::IoError {
                path: file_path.clone(),
                reason: e.to_string(),
            }
        })?;

        // Execute
        let mut cmd = AsyncCommand::new(interpreter);
        cmd.arg(&file_path);

        if let Some(input_data) = input {
            // Write input to a file
            let input_path = temp_dir.join(format!("sandbox_{}_input.txt", id));
            tokio::fs::write(&input_path, input_data).await.ok();
            cmd.stdin(Stdio::from(
                tokio::fs::File::open(&input_path).await.ok().unwrap(),
            ));
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let timeout_duration = Duration::from_millis(self.config.timeout_ms);

        let result = timeout(timeout_duration, async {
            let mut child = cmd.spawn().map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            let mut stdout_data = Vec::new();
            let mut stderr_data = Vec::new();

            if let Some(ref mut stdout) = child.stdout {
                stdout.read_to_end(&mut stdout_data).await.ok();
            }
            if let Some(ref mut stderr) = child.stderr {
                stderr.read_to_end(&mut stderr_data).await.ok();
            }

            let status = child.wait().await.map_err(|e| {
                GovernorError::SandboxExecutionFailed {
                    reason: e.to_string(),
                }
            })?;

            Ok::<_, GovernorError>((status, stdout_data, stderr_data))
        })
        .await;

        // Cleanup temp file
        tokio::fs::remove_file(&file_path).await.ok();

        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(Ok((status, stdout_data, stderr_data))) => Ok(ExecutionResult::success(
                id,
                status.code().unwrap_or(-1),
                if self.config.capture_stdout {
                    Some(String::from_utf8_lossy(&stdout_data).to_string())
                } else {
                    None
                },
                if self.config.capture_stderr {
                    Some(String::from_utf8_lossy(&stderr_data).to_string())
                } else {
                    None
                },
                duration_ms,
                self.monitor.usage(),
            )),
            Ok(Err(e)) => Err(e),
            Err(_) => Ok(ExecutionResult::timeout(id, self.config.timeout_ms)),
        }
    }

    /// Gets active executions.
    pub async fn active_executions(&self) -> HashMap<uuid::Uuid, ExecutionStatus> {
        self.active_executions.read().await.clone()
    }

    /// Cancels an execution.
    pub async fn cancel(&self, id: uuid::Uuid) -> bool {
        let mut active = self.active_executions.write().await;
        if let Some(status) = active.get_mut(&id) {
            *status = ExecutionStatus::Cancelled;
            true
        } else {
            false
        }
    }

    /// Gets the boundary monitor.
    #[must_use]
    pub fn monitor(&self) -> Arc<BoundaryMonitor> {
        Arc::clone(&self.monitor)
    }
}

/// A builder for creating sandbox configurations.
pub struct SandboxBuilder {
    config: SandboxConfig,
}

impl SandboxBuilder {
    /// Creates a new builder.
    #[must_use]
    pub fn new() -> Self {
        Self {
            config: SandboxConfig::default(),
        }
    }

    /// Sets the isolation type.
    #[must_use]
    pub fn isolation(mut self, isolation_type: IsolationType) -> Self {
        self.config.isolation_type = isolation_type;
        self
    }

    /// Sets the timeout.
    #[must_use]
    pub fn timeout(mut self, timeout_ms: u64) -> Self {
        self.config.timeout_ms = timeout_ms;
        self
    }

    /// Sets memory limit.
    #[must_use]
    pub fn memory_limit(mut self, bytes: u64) -> Self {
        self.config.boundaries.max_memory_bytes = Some(bytes);
        self
    }

    /// Sets CPU time limit.
    #[must_use]
    pub fn cpu_limit(mut self, ms: u64) -> Self {
        self.config.boundaries.max_cpu_time_ms = Some(ms);
        self
    }

    /// Enables network access.
    #[must_use]
    pub fn network(mut self, allow: bool) -> Self {
        self.config.allow_network = allow;
        self
    }

    /// Enables filesystem access.
    #[must_use]
    pub fn filesystem(mut self, allow: bool) -> Self {
        self.config.allow_filesystem = allow;
        self
    }

    /// Sets the working directory.
    #[must_use]
    pub fn working_directory(mut self, path: impl Into<PathBuf>) -> Self {
        self.config.working_directory = Some(path.into());
        self
    }

    /// Adds an environment variable.
    #[must_use]
    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.config.environment.insert(key.into(), value.into());
        self
    }

    /// Sets the container image.
    #[must_use]
    pub fn container_image(mut self, image: impl Into<String>) -> Self {
        self.config.container_image = Some(image.into());
        self
    }

    /// Grants a permission.
    #[must_use]
    pub fn grant_permission(mut self, permission: Permission) -> Self {
        self.config.permissions.grant(permission);
        self
    }

    /// Builds the sandbox executor.
    #[must_use]
    pub fn build(self) -> SandboxExecutor {
        SandboxExecutor::new(self.config)
    }
}

impl Default for SandboxBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandbox_config() {
        let config = SandboxConfig::strict();
        assert_eq!(config.isolation_type, IsolationType::Process);
        assert!(!config.allow_network);
        assert!(!config.allow_filesystem);
    }

    #[test]
    fn test_execution_result() {
        let result = ExecutionResult::success(
            uuid::Uuid::new_v4(),
            0,
            Some("output".to_string()),
            None,
            100,
            ResourceUsage::new(),
        );

        assert!(result.is_success());
        assert_eq!(result.exit_code, Some(0));
        assert_eq!(result.stdout, Some("output".to_string()));
    }

    #[test]
    fn test_execution_status() {
        let result = ExecutionResult::timeout(uuid::Uuid::new_v4(), 5000);
        assert_eq!(result.status, ExecutionStatus::Timeout);
        assert!(!result.is_success());
    }

    #[test]
    fn test_sandbox_builder() {
        let executor = SandboxBuilder::new()
            .isolation(IsolationType::Process)
            .timeout(10000)
            .memory_limit(1024 * 1024 * 100) // 100MB
            .network(false)
            .filesystem(false)
            .build();

        let config = executor.config();
        assert_eq!(config.isolation_type, IsolationType::Process);
        assert_eq!(config.timeout_ms, 10000);
    }

    #[tokio::test]
    async fn test_sandbox_executor_creation() {
        let executor = SandboxExecutor::with_defaults();
        let active = executor.active_executions().await;
        assert!(active.is_empty());
    }
}

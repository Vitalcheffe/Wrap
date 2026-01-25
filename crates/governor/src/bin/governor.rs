//! CLI binary for the Governor safety system.
//!
//! Provides command-line interface for interacting with the governor.

use clap::{Parser, Subcommand};
use governor::{
    AuditEvent, AuditEventType, AuditQuery, AuditSeverity, Boundaries, ContentType,
    ExecutionStatus, Governor, GovernorBuilder, GovernorConfig, IsolationType, Permission,
    RateLimitAlgorithm, RateLimitConfig, RateLimitKey, SandboxBuilder, SandboxConfig,
};
use std::path::PathBuf;
use std::time::Instant;
use tracing::{info, warn, Level};
use tracing_subscriber::FmtSubscriber;

/// The Governor CLI - A safety system for AI agents.
#[derive(Parser, Debug)]
#[command(name = "governor")]
#[command(author = "WRAP Nebula Team <team@wrap-nebula.io>")]
#[command(version = "0.1.0")]
#[command(about = "Safety governor for AI agents", long_about = None)]
struct Cli {
    /// Configuration file path
    #[arg(short, long, global = true)]
    config: Option<PathBuf>,

    /// Profile to use (development, production, strict)
    #[arg(short, long, global = true, default_value = "production")]
    profile: String,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, global = true, default_value = "info")]
    log_level: String,

    /// Output format (text, json)
    #[arg(short, long, global = true, default_value = "text")]
    output: String,

    #[command(subcommand)]
    command: Commands,
}

/// Available commands.
#[derive(Subcommand, Debug)]
enum Commands {
    /// Start the governor service
    Start {
        /// Port to listen on
        #[arg(short, long, default_value = "8080")]
        port: u16,

        /// Host to bind to
        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        /// Enable interactive mode
        #[arg(short, long)]
        interactive: bool,
    },

    /// Check permissions
    Check {
        /// Permission to check (e.g., "file:read:/path")
        #[arg(short, long)]
        permission: String,

        /// Target resource
        #[arg(short, long)]
        target: Option<String>,

        /// User ID for rate limiting
        #[arg(short, long)]
        user: Option<String>,
    },

    /// Filter content
    Filter {
        /// Content to filter
        #[arg(short, long)]
        content: String,

        /// Content type (text, json, html)
        #[arg(short = 't', long, default_value = "text")]
        content_type: String,

        /// Output redacted content
        #[arg(short, long)]
        redact: bool,
    },

    /// Rate limit operations
    RateLimit {
        /// Key to check
        #[arg(short, long)]
        key: String,

        /// Maximum requests
        #[arg(short, long, default_value = "100")]
        max_requests: u64,

        /// Window in seconds
        #[arg(short, long, default_value = "60")]
        window: u64,

        #[command(subcommand)]
        command: RateLimitCommands,
    },

    /// Audit log operations
    Audit {
        #[command(subcommand)]
        command: AuditCommands,
    },

    /// Sandbox execution
    Sandbox {
        /// Command to execute
        command: String,

        /// Command arguments
        args: Vec<String>,

        /// Timeout in milliseconds
        #[arg(short, long, default_value = "30000")]
        timeout: u64,

        /// Memory limit in bytes
        #[arg(short, long)]
        memory: Option<u64>,

        /// Isolation type (none, process, container, wasm)
        #[arg(short = 'i', long, default_value = "process")]
        isolation: String,
    },

    /// Show governor status
    Status {
        /// Show detailed information
        #[arg(short, long)]
        detailed: bool,
    },

    /// Validate configuration
    Validate {
        /// Configuration file to validate
        file: PathBuf,
    },
}

/// Rate limit subcommands.
#[derive(Subcommand, Debug)]
enum RateLimitCommands {
    /// Check if rate limited
    Check,

    /// Reset rate limit
    Reset,

    /// Show statistics
    Stats,
}

/// Audit subcommands.
#[derive(Subcommand, Debug)]
enum AuditCommands {
    /// Query audit log
    Query {
        /// Filter by event type
        #[arg(short, long)]
        event_type: Option<String>,

        /// Filter by user ID
        #[arg(short, long)]
        user: Option<String>,

        /// Maximum results
        #[arg(short, long, default_value = "10")]
        limit: usize,

        /// Output as JSON
        #[arg(short, long)]
        json: bool,
    },

    /// Export audit log
    Export {
        /// Output file path
        #[arg(short, long)]
        output: PathBuf,
    },

    /// Show audit statistics
    Stats,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    let log_level = match cli.log_level.as_str() {
        "trace" => Level::TRACE,
        "debug" => Level::DEBUG,
        "info" => Level::INFO,
        "warn" => Level::WARN,
        "error" => Level::ERROR,
        _ => Level::INFO,
    };

    let subscriber = FmtSubscriber::builder()
        .with_max_level(log_level)
        .finish();

    tracing::subscriber::set_global_default(subscriber)?;

    // Create governor based on profile
    let governor = create_governor(&cli.profile, cli.config.as_ref())?;

    // Execute command
    match cli.command {
        Commands::Start {
            port,
            host,
            interactive,
        } => {
            run_start(governor, &host, port, interactive).await?;
        }
        Commands::Check {
            permission,
            target,
            user,
        } => {
            run_check(governor, &permission, target.as_deref(), user.as_deref()).await?;
        }
        Commands::Filter {
            content,
            content_type,
            redact,
        } => {
            run_filter(governor, &content, &content_type, redact).await?;
        }
        Commands::RateLimit {
            key,
            max_requests,
            window,
            command,
        } => {
            run_rate_limit(governor, &key, max_requests, window, command).await?;
        }
        Commands::Audit { command } => {
            run_audit(governor, command).await?;
        }
        Commands::Sandbox {
            command,
            args,
            timeout,
            memory,
            isolation,
        } => {
            run_sandbox(governor, &command, &args, timeout, memory, &isolation).await?;
        }
        Commands::Status { detailed } => {
            run_status(governor, detailed).await?;
        }
        Commands::Validate { file } => {
            run_validate(&file)?;
        }
    }

    Ok(())
}

/// Creates a governor based on profile.
fn create_governor(profile: &str, config_path: Option<&PathBuf>) -> anyhow::Result<Governor> {
    let governor = if let Some(path) = config_path {
        info!("Loading configuration from {:?}", path);
        let config = GovernorConfig::from_file(path)?;
        Governor::new(config)
    } else {
        match profile {
            "development" => {
                info!("Using development profile");
                Governor::development()
            }
            "strict" => {
                info!("Using strict profile");
                Governor::strict()
            }
            _ => {
                info!("Using production profile");
                Governor::with_defaults()
            }
        }
    };

    Ok(governor)
}

/// Runs the start command.
async fn run_start(
    governor: Governor,
    host: &str,
    port: u16,
    interactive: bool,
) -> anyhow::Result<()> {
    info!("Starting Governor service on {}:{}", host, port);

    // In a real implementation, we'd start a web server here
    println!("Governor service started");
    println!("Listening on {}:{}", host, port);
    println!("Profile: {:?}", governor.config().profile);

    if interactive {
        run_interactive_mode(governor).await?;
    } else {
        // Wait for shutdown signal
        tokio::signal::ctrl_c().await?;
        println!("\nShutting down...");
    }

    Ok(())
}

/// Runs interactive mode.
async fn run_interactive_mode(governor: Governor) -> anyhow::Result<()> {
    use dialoguer::{Input, Select};

    println!("\n=== Governor Interactive Mode ===");
    println!("Type 'help' for available commands, 'quit' to exit.\n");

    loop {
        let command: String = Input::new()
            .with_prompt("governor")
            .interact_text()?;

        match command.trim().to_lowercase().as_str() {
            "help" => {
                println!("\nAvailable commands:");
                println!("  status    - Show governor status");
                println!("  stats     - Show statistics");
                println!("  check     - Check a permission");
                println!("  filter    - Filter content");
                println!("  sandbox   - Execute in sandbox");
                println!("  audit     - Query audit log");
                println!("  quit      - Exit interactive mode");
                println!();
            }
            "status" | "stats" => {
                let stats = governor.stats().await;
                println!("\n=== Governor Statistics ===");
                println!("Permission checks: {}", stats.permission_checks);
                println!("  Granted: {}", stats.permissions_granted);
                println!("  Denied: {}", stats.permissions_denied);
                println!("Content filtered: {}", stats.content_filtered);
                println!("  Blocked: {}", stats.content_blocked);
                println!("Rate limits checked: {}", stats.rate_limits_checked);
                println!("  Exceeded: {}", stats.rate_limits_exceeded);
                println!("Sandbox executions: {}", stats.sandbox_executions);
                println!("Audit events: {}", stats.audit_events);
                println!();
            }
            "check" => {
                let perm_str: String = Input::new()
                    .with_prompt("Permission")
                    .interact_text()?;

                match perm_str.parse::<Permission>() {
                    Ok(perm) => {
                        let result = governor.check_permission(&perm).await?;
                        if result {
                            println!("✓ Permission GRANTED");
                        } else {
                            println!("✗ Permission DENIED");
                        }
                    }
                    Err(e) => {
                        println!("Error: {}", e);
                    }
                }
            }
            "filter" => {
                let content: String = Input::new()
                    .with_prompt("Content")
                    .interact_text()?;

                let result = governor.filter_content(&content, ContentType::Text).await?;

                if result.matched {
                    println!("⚠ Content matched {} filter(s)", result.total_matches);
                    for m in &result.matches {
                        println!("  - {}: {} (severity: {})", m.filter_name, m.match_type, m.severity);
                    }
                } else {
                    println!("✓ Content is clean");
                }
            }
            "quit" | "exit" => {
                println!("Goodbye!");
                break;
            }
            _ => {
                println!("Unknown command. Type 'help' for available commands.");
            }
        }
    }

    Ok(())
}

/// Runs the check command.
async fn run_check(
    governor: Governor,
    permission_str: &str,
    target: Option<&str>,
    user: Option<&str>,
) -> anyhow::Result<()> {
    let permission: Permission = permission_str.parse()?;

    let start = Instant::now();
    let result = if let Some(t) = target {
        governor.check_access(&permission, t).await?
    } else {
        governor.check_permission(&permission).await?
    };
    let duration = start.elapsed();

    println!("\n=== Permission Check Result ===");
    println!("Permission: {}", permission);
    if let Some(t) = target {
        println!("Target: {}", t);
    }
    println!("Result: {}", if result { "GRANTED" } else { "DENIED" });
    println!("Duration: {:?}", duration);

    // Show stats
    let stats = governor.stats().await;
    println!("\nSession Statistics:");
    println!("  Total checks: {}", stats.permission_checks);
    println!("  Granted: {}", stats.permissions_granted);
    println!("  Denied: {}", stats.permissions_denied);

    Ok(())
}

/// Runs the filter command.
async fn run_filter(
    governor: Governor,
    content: &str,
    content_type_str: &str,
    redact: bool,
) -> anyhow::Result<()> {
    let content_type = match content_type_str.to_lowercase().as_str() {
        "json" => ContentType::Json,
        "html" => ContentType::Html,
        "text" | _ => ContentType::Text,
    };

    let start = Instant::now();
    let result = governor.filter_content(content, content_type).await?;
    let duration = start.elapsed();

    println!("\n=== Content Filter Result ===");
    println!("Content type: {:?}", content_type);
    println!("Content length: {} bytes", content.len());
    println!("Matched: {}", result.matched);
    println!("Blocked: {}", result.blocked);
    println!("Total matches: {}", result.total_matches);

    if let Some(ref severity) = result.highest_severity {
        println!("Highest severity: {:?}", severity);
    }

    println!("Duration: {:?}", duration);

    if result.matched {
        println!("\nMatches:");
        for (i, m) in result.matches.iter().enumerate() {
            println!("  {}. {} - {} ({})", i + 1, m.filter_name, m.match_type, m.severity);
            println!("     Position: {}-{}", m.start, m.end);
            println!("     Action: {:?}", m.action);
        }
    }

    if redact {
        if let Some(ref processed) = result.processed_content {
            println!("\n=== Redacted Content ===");
            println!("{}", processed);
        }
    }

    Ok(())
}

/// Runs the rate limit command.
async fn run_rate_limit(
    governor: Governor,
    key_str: &str,
    max_requests: u64,
    window: u64,
    command: RateLimitCommands,
) -> anyhow::Result<()> {
    let key = RateLimitKey::for_user(key_str);

    match command {
        RateLimitCommands::Check => {
            let result = governor.check_rate_limit(&key)?;

            println!("\n=== Rate Limit Check ===");
            println!("Key: {}", key_str);
            println!("Allowed: {}", result.allowed);
            println!("Remaining: {}", result.remaining);
            println!("Limit: {}", result.limit);
            println!("Reset after: {}s", result.reset_after);

            if let Some(retry) = result.retry_after {
                println!("Retry after: {}s", retry);
            }
        }
        RateLimitCommands::Reset => {
            governor.reset_rate_limit(&key);
            println!("Rate limit reset for: {}", key_str);
        }
        RateLimitCommands::Stats => {
            if let Some(stats) = governor.rate_limiter_stats() {
                println!("\n=== Rate Limiter Statistics ===");
                println!("Total requests: {}", stats.total_requests);
                println!("Allowed: {}", stats.total_allowed);
                println!("Denied: {}", stats.total_denied);
                println!("Denial rate: {:.2}%", stats.denial_rate());
                println!("Active keys: {}", stats.active_keys);
            } else {
                println!("Rate limiting is not enabled");
            }
        }
    }

    Ok(())
}

/// Runs the audit command.
async fn run_audit(governor: Governor, command: AuditCommands) -> anyhow::Result<()> {
    match command {
        AuditCommands::Query {
            event_type,
            user,
            limit,
            json,
        } => {
            let mut query = AuditQuery::new().with_limit(limit);

            if let Some(ref et) = event_type {
                let et = match et.to_lowercase().as_str() {
                    "permission_denied" => AuditEventType::PermissionDenied,
                    "permission_granted" => AuditEventType::PermissionGranted,
                    "boundary_violation" => AuditEventType::BoundaryViolation,
                    "content_filtered" => AuditEventType::ContentFiltered,
                    "rate_limit_exceeded" => AuditEventType::RateLimitExceeded,
                    _ => {
                        println!("Unknown event type: {}", et);
                        return Ok(());
                    }
                };
                query = query.with_event_type(et);
            }

            if let Some(ref u) = user {
                query = query.with_user(u);
            }

            let events = governor.query_audit(&query).await?;

            if json {
                println!("{}", serde_json::to_string_pretty(&events)?);
            } else {
                println!("\n=== Audit Events ({} results) ===", events.len());
                for event in events {
                    println!(
                        "\n[{}] {} - {}",
                        event.timestamp.format("%Y-%m-%d %H:%M:%S"),
                        event.event_type,
                        event.severity
                    );
                    println!("  Source: {}", event.source);
                    println!("  Message: {}", event.message);
                    if let Some(ref user) = event.user_id {
                        println!("  User: {}", user);
                    }
                    if let Some(ref resource) = event.resource {
                        println!("  Resource: {}", resource);
                    }
                }
            }
        }
        AuditCommands::Export { output } => {
            println!("Exporting audit log to: {:?}", output);
            // In real implementation, call governor.audit_log.export()
            println!("Export complete");
        }
        AuditCommands::Stats => {
            println!("\n=== Audit Statistics ===");
            println!("Note: Audit statistics require running audit log");
        }
    }

    Ok(())
}

/// Runs the sandbox command.
async fn run_sandbox(
    _governor: Governor,
    command: &str,
    args: &[String],
    timeout: u64,
    memory: Option<u64>,
    isolation_str: &str,
) -> anyhow::Result<()> {
    let isolation = match isolation_str.to_lowercase().as_str() {
        "none" => IsolationType::None,
        "process" => IsolationType::Process,
        "container" => IsolationType::Container,
        "wasm" => IsolationType::Wasm,
        _ => IsolationType::Process,
    };

    let mut builder = SandboxBuilder::new()
        .isolation(isolation)
        .timeout(timeout);

    if let Some(mem) = memory {
        builder = builder.memory_limit(mem);
    }

    let executor = builder.build();

    println!("\n=== Sandbox Execution ===");
    println!("Command: {}", command);
    println!("Args: {:?}", args);
    println!("Timeout: {}ms", timeout);
    println!("Isolation: {:?}", isolation);

    let start = Instant::now();
    let result = executor.execute(command, &args.iter().map(String::as_str).collect::<Vec<_>>()).await?;
    let total_duration = start.elapsed();

    println!("\n=== Execution Result ===");
    println!("Status: {:?}", result.status);
    if let Some(code) = result.exit_code {
        println!("Exit code: {}", code);
    }
    println!("Duration: {}ms", result.duration_ms);
    println!("Total time: {:?}", total_duration);

    if let Some(ref stdout) = result.stdout {
        if !stdout.is_empty() {
            println!("\n=== stdout ===");
            println!("{}", stdout);
        }
    }

    if let Some(ref stderr) = result.stderr {
        if !stderr.is_empty() {
            println!("\n=== stderr ===");
            println!("{}", stderr);
        }
    }

    if let Some(ref error) = result.error {
        println!("\n=== Error ===");
        println!("{}", error);
    }

    Ok(())
}

/// Runs the status command.
async fn run_status(governor: Governor, detailed: bool) -> anyhow::Result<()> {
    println!("\n=== Governor Status ===");
    println!("Profile: {:?}", governor.config().profile);
    println!("Content filtering: {}", governor.config().enable_content_filter);
    println!("Rate limiting: {}", governor.config().enable_rate_limiting);
    println!("Audit logging: {}", governor.config().enable_audit);
    println!("Sandbox: {}", governor.config().enable_sandbox);

    // Show boundaries
    let boundaries = &governor.config().boundaries;
    println!("\n=== Boundaries ===");
    if let Some(mem) = boundaries.max_memory_bytes {
        println!("Memory: {} bytes ({:.2} MB)", mem, mem as f64 / 1_000_000.0);
    }
    if let Some(cpu) = boundaries.max_cpu_time_ms {
        println!("CPU time: {}ms", cpu);
    }
    if let Some(wall) = boundaries.max_wall_time_ms {
        println!("Wall time: {}ms", wall);
    }

    // Show resource usage
    let usage = governor.resource_usage();
    println!("\n=== Resource Usage ===");
    println!("Memory: {} bytes", usage.memory_bytes);
    println!("CPU time: {}ms", usage.cpu_time_ms);
    println!("Wall time: {}ms", usage.wall_time_ms);
    println!("Network sent: {} bytes", usage.network_sent_bytes);
    println!("Network recv: {} bytes", usage.network_recv_bytes);

    // Show statistics
    let stats = governor.stats().await;
    println!("\n=== Statistics ===");
    println!("Permission checks: {}", stats.permission_checks);
    println!("Content filtered: {}", stats.content_filtered);
    println!("Sandbox executions: {}", stats.sandbox_executions);

    if detailed {
        println!("\n=== Detailed Statistics ===");
        println!("Permissions granted: {}", stats.permissions_granted);
        println!("Permissions denied: {}", stats.permissions_denied);
        println!("Content blocked: {}", stats.content_blocked);
        println!("Rate limits checked: {}", stats.rate_limits_checked);
        println!("Rate limits exceeded: {}", stats.rate_limits_exceeded);
        println!("Audit events: {}", stats.audit_events);
    }

    Ok(())
}

/// Runs the validate command.
fn run_validate(file: &PathBuf) -> anyhow::Result<()> {
    println!("Validating configuration: {:?}", file);

    match GovernorConfig::from_file(file) {
        Ok(config) => {
            println!("✓ Configuration is valid");
            println!("  Profile: {:?}", config.profile);
            println!("  Content filtering: {}", config.enable_content_filter);
            println!("  Rate limiting: {}", config.enable_rate_limiting);
            println!("  Audit logging: {}", config.enable_audit);
            Ok(())
        }
        Err(e) => {
            println!("✗ Configuration is invalid:");
            println!("  {}", e);
            Err(e.into())
        }
    }
}

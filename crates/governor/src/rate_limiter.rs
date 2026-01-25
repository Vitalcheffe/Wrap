//! Rate limiting for the Governor safety system.
//!
//! This module provides comprehensive rate limiting with multiple algorithms:
//! - Fixed window
//! - Sliding window
//! - Token bucket
//! - Leaky bucket
//! - Per-user and per-resource limiting

use crate::error::{GovernorError, Result};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Algorithm used for rate limiting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitAlgorithm {
    /// Fixed window algorithm
    FixedWindow,
    /// Sliding window algorithm
    #[default]
    SlidingWindow,
    /// Token bucket algorithm
    TokenBucket,
    /// Leaky bucket algorithm
    LeakyBucket,
}

impl fmt::Display for RateLimitAlgorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FixedWindow => write!(f, "fixed_window"),
            Self::SlidingWindow => write!(f, "sliding_window"),
            Self::TokenBucket => write!(f, "token_bucket"),
            Self::LeakyBucket => write!(f, "leaky_bucket"),
        }
    }
}

impl std::str::FromStr for RateLimitAlgorithm {
    type Err = GovernorError;

    fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "fixed_window" | "fixedwindow" | "fixed" => Ok(Self::FixedWindow),
            "sliding_window" | "slidingwindow" | "sliding" => Ok(Self::SlidingWindow),
            "token_bucket" | "tokenbucket" | "token" => Ok(Self::TokenBucket),
            "leaky_bucket" | "leakybucket" | "leaky" => Ok(Self::LeakyBucket),
            _ => Err(GovernorError::InvalidRateLimitAlgorithm {
                algorithm: s.to_string(),
            }),
        }
    }
}

/// Configuration for a rate limit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    /// Maximum number of requests allowed
    pub max_requests: u64,
    /// Time window in seconds
    pub window_seconds: u64,
    /// Algorithm to use
    pub algorithm: RateLimitAlgorithm,
    /// Burst size (for token bucket)
    pub burst_size: Option<u64>,
    /// Refill rate (tokens per second, for token bucket)
    pub refill_rate: Option<f64>,
    /// Whether to include headers in responses
    pub include_headers: bool,
    /// Key prefix for identification
    pub key_prefix: Option<String>,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests: 100,
            window_seconds: 60,
            algorithm: RateLimitAlgorithm::default(),
            burst_size: None,
            refill_rate: None,
            include_headers: true,
            key_prefix: None,
        }
    }
}

impl RateLimitConfig {
    /// Creates a new rate limit configuration.
    #[must_use]
    pub fn new(max_requests: u64, window_seconds: u64) -> Self {
        Self {
            max_requests,
            window_seconds,
            ..Default::default()
        }
    }

    /// Creates a strict rate limit (10 requests per minute).
    #[must_use]
    pub fn strict() -> Self {
        Self::new(10, 60)
    }

    /// Creates a lenient rate limit (1000 requests per minute).
    #[must_use]
    pub fn lenient() -> Self {
        Self::new(1000, 60)
    }

    /// Sets the algorithm.
    #[must_use]
    pub fn with_algorithm(mut self, algorithm: RateLimitAlgorithm) -> Self {
        self.algorithm = algorithm;
        self
    }

    /// Sets the burst size for token bucket.
    #[must_use]
    pub fn with_burst(mut self, burst_size: u64) -> Self {
        self.burst_size = Some(burst_size);
        self
    }

    /// Sets the refill rate for token bucket.
    #[must_use]
    pub fn with_refill_rate(mut self, rate: f64) -> Self {
        self.refill_rate = Some(rate);
        self
    }

    /// Sets the key prefix.
    #[must_use]
    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.key_prefix = Some(prefix.into());
        self
    }
}

/// A key for rate limiting.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RateLimitKey {
    /// User identifier
    pub user_id: Option<String>,
    /// Resource identifier
    pub resource: Option<String>,
    /// IP address
    pub ip_address: Option<String>,
    /// Custom identifier
    pub custom: Option<String>,
    /// Scope for the key
    pub scope: RateLimitScope,
}

impl Default for RateLimitKey {
    fn default() -> Self {
        Self {
            user_id: None,
            resource: None,
            ip_address: None,
            custom: None,
            scope: RateLimitScope::Global,
        }
    }
}

impl RateLimitKey {
    /// Creates a new rate limit key for a user.
    #[must_use]
    pub fn for_user(user_id: impl Into<String>) -> Self {
        Self {
            user_id: Some(user_id.into()),
            scope: RateLimitScope::User,
            ..Default::default()
        }
    }

    /// Creates a new rate limit key for a resource.
    #[must_use]
    pub fn for_resource(resource: impl Into<String>) -> Self {
        Self {
            resource: Some(resource.into()),
            scope: RateLimitScope::Resource,
            ..Default::default()
        }
    }

    /// Creates a new rate limit key for an IP address.
    #[must_use]
    pub fn for_ip(ip: impl Into<String>) -> Self {
        Self {
            ip_address: Some(ip.into()),
            scope: RateLimitScope::IpAddress,
            ..Default::default()
        }
    }

    /// Creates a global rate limit key.
    #[must_use]
    pub fn global() -> Self {
        Self::default()
    }

    /// Creates a custom rate limit key.
    #[must_use]
    pub fn custom(key: impl Into<String>) -> Self {
        Self {
            custom: Some(key.into()),
            scope: RateLimitScope::Custom,
            ..Default::default()
        }
    }

    /// Converts the key to a string representation.
    #[must_use]
    pub fn to_string_key(&self) -> String {
        match self.scope {
            RateLimitScope::Global => "global".to_string(),
            RateLimitScope::User => format!("user:{}", self.user_id.as_deref().unwrap_or("unknown")),
            RateLimitScope::Resource => {
                format!("resource:{}", self.resource.as_deref().unwrap_or("unknown"))
            }
            RateLimitScope::IpAddress => {
                format!("ip:{}", self.ip_address.as_deref().unwrap_or("unknown"))
            }
            RateLimitScope::Custom => format!("custom:{}", self.custom.as_deref().unwrap_or("unknown")),
            RateLimitScope::Combined => {
                let mut parts = Vec::new();
                if let Some(ref user) = self.user_id {
                    parts.push(format!("user:{user}"));
                }
                if let Some(ref resource) = self.resource {
                    parts.push(format!("resource:{resource}"));
                }
                if let Some(ref ip) = self.ip_address {
                    parts.push(format!("ip:{ip}"));
                }
                if let Some(ref custom) = self.custom {
                    parts.push(format!("custom:{custom}"));
                }
                parts.join(":")
            }
        }
    }
}

/// Scope for rate limiting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitScope {
    /// Global rate limit
    #[default]
    Global,
    /// Per-user rate limit
    User,
    /// Per-resource rate limit
    Resource,
    /// Per-IP rate limit
    IpAddress,
    /// Custom rate limit
    Custom,
    /// Combined rate limit
    Combined,
}

/// Result of a rate limit check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitResult {
    /// Whether the request is allowed
    pub allowed: bool,
    /// Number of requests remaining
    pub remaining: u64,
    /// Time until the limit resets (in seconds)
    pub reset_after: u64,
    /// Time until the next request is allowed (in seconds)
    pub retry_after: Option<u64>,
    /// Current limit
    pub limit: u64,
    /// Key that was checked
    pub key: String,
    /// Algorithm used
    pub algorithm: RateLimitAlgorithm,
}

impl RateLimitResult {
    /// Creates an allowed result.
    #[must_use]
    pub fn allowed(remaining: u64, reset_after: u64, limit: u64, key: String, algorithm: RateLimitAlgorithm) -> Self {
        Self {
            allowed: true,
            remaining,
            reset_after,
            retry_after: None,
            limit,
            key,
            algorithm,
        }
    }

    /// Creates a denied result.
    #[must_use]
    pub fn denied(reset_after: u64, retry_after: u64, limit: u64, key: String, algorithm: RateLimitAlgorithm) -> Self {
        Self {
            allowed: false,
            remaining: 0,
            reset_after,
            retry_after: Some(retry_after),
            limit,
            key,
            algorithm,
        }
    }
}

/// State for fixed window rate limiting.
#[derive(Debug, Clone)]
struct FixedWindowState {
    count: u64,
    window_start: Instant,
}

/// State for sliding window rate limiting.
#[derive(Debug, Clone)]
struct SlidingWindowState {
    timestamps: Vec<Instant>,
}

/// State for token bucket rate limiting.
#[derive(Debug)]
struct TokenBucketState {
    tokens: f64,
    last_refill: Instant,
}

/// State for leaky bucket rate limiting.
#[derive(Debug)]
struct LeakyBucketState {
    water_level: f64,
    last_leak: Instant,
}

/// The main rate limiter implementation.
#[derive(Debug)]
pub struct RateLimiter {
    /// Configuration
    config: RateLimitConfig,
    /// Fixed window states
    fixed_windows: DashMap<String, FixedWindowState>,
    /// Sliding window states
    sliding_windows: DashMap<String, SlidingWindowState>,
    /// Token bucket states
    token_buckets: DashMap<String, TokenBucketState>,
    /// Leaky bucket states
    leaky_buckets: DashMap<String, LeakyBucketState>,
    /// Total requests processed
    total_requests: AtomicU64,
    /// Total requests allowed
    total_allowed: AtomicU64,
    /// Total requests denied
    total_denied: AtomicU64,
}

impl RateLimiter {
    /// Creates a new rate limiter with the given configuration.
    #[must_use]
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            fixed_windows: DashMap::new(),
            sliding_windows: DashMap::new(),
            token_buckets: DashMap::new(),
            leaky_buckets: DashMap::new(),
            total_requests: AtomicU64::new(0),
            total_allowed: AtomicU64::new(0),
            total_denied: AtomicU64::new(0),
        }
    }

    /// Creates a rate limiter with default configuration.
    #[must_use]
    pub fn with_defaults() -> Self {
        Self::new(RateLimitConfig::default())
    }

    /// Creates a rate limiter for a specific limit.
    #[must_use]
    pub fn per_minute(max_requests: u64) -> Self {
        Self::new(RateLimitConfig::new(max_requests, 60))
    }

    /// Creates a rate limiter for per-hour limiting.
    #[must_use]
    pub fn per_hour(max_requests: u64) -> Self {
        Self::new(RateLimitConfig::new(max_requests, 3600))
    }

    /// Gets the configuration.
    #[must_use]
    pub fn config(&self) -> &RateLimitConfig {
        &self.config
    }

    /// Checks if a request is allowed using the fixed window algorithm.
    fn check_fixed_window(&self, key: &str) -> RateLimitResult {
        let window_duration = Duration::from_secs(self.config.window_seconds);
        let now = Instant::now();

        let mut state = self
            .fixed_windows
            .entry(key.to_string())
            .or_insert(FixedWindowState {
                count: 0,
                window_start: now,
            });

        // Check if window has expired
        if now.duration_since(state.window_start) >= window_duration {
            state.count = 0;
            state.window_start = now;
        }

        if state.count < self.config.max_requests {
            state.count += 1;
            let remaining = self.config.max_requests - state.count;
            let reset_after = window_duration
                .saturating_sub(now.duration_since(state.window_start))
                .as_secs();

            RateLimitResult::allowed(
                remaining,
                reset_after,
                self.config.max_requests,
                key.to_string(),
                RateLimitAlgorithm::FixedWindow,
            )
        } else {
            let reset_after = window_duration
                .saturating_sub(now.duration_since(state.window_start))
                .as_secs();

            RateLimitResult::denied(
                reset_after,
                reset_after,
                self.config.max_requests,
                key.to_string(),
                RateLimitAlgorithm::FixedWindow,
            )
        }
    }

    /// Checks if a request is allowed using the sliding window algorithm.
    fn check_sliding_window(&self, key: &str) -> RateLimitResult {
        let window_duration = Duration::from_secs(self.config.window_seconds);
        let now = Instant::now();

        let mut state = self
            .sliding_windows
            .entry(key.to_string())
            .or_insert(SlidingWindowState {
                timestamps: Vec::new(),
            });

        // Remove expired timestamps
        state
            .timestamps
            .retain(|&ts| now.duration_since(ts) < window_duration);

        if (state.timestamps.len() as u64) < self.config.max_requests {
            state.timestamps.push(now);
            let remaining = self.config.max_requests - state.timestamps.len() as u64;
            let oldest = state.timestamps.first();
            let reset_after = oldest
                .map(|ts| window_duration.saturating_sub(now.duration_since(*ts)).as_secs())
                .unwrap_or(window_duration.as_secs());

            RateLimitResult::allowed(
                remaining,
                reset_after,
                self.config.max_requests,
                key.to_string(),
                RateLimitAlgorithm::SlidingWindow,
            )
        } else {
            let oldest = state.timestamps.first();
            let reset_after = oldest
                .map(|ts| window_duration.saturating_sub(now.duration_since(*ts)).as_secs())
                .unwrap_or(window_duration.as_secs());

            RateLimitResult::denied(
                reset_after,
                reset_after,
                self.config.max_requests,
                key.to_string(),
                RateLimitAlgorithm::SlidingWindow,
            )
        }
    }

    /// Checks if a request is allowed using the token bucket algorithm.
    fn check_token_bucket(&self, key: &str) -> RateLimitResult {
        let burst_size = self.config.burst_size.unwrap_or(self.config.max_requests);
        let refill_rate = self.config.refill_rate.unwrap_or(1.0);
        let now = Instant::now();

        let mut state = self
            .token_buckets
            .entry(key.to_string())
            .or_insert(TokenBucketState {
                tokens: burst_size as f64,
                last_refill: now,
            });

        // Refill tokens based on elapsed time
        let elapsed = now.duration_since(state.last_refill).as_secs_f64();
        let tokens_to_add = elapsed * refill_rate;
        state.tokens = (state.tokens + tokens_to_add).min(burst_size as f64);
        state.last_refill = now;

        if state.tokens >= 1.0 {
            state.tokens -= 1.0;
            let remaining = state.tokens.floor();
            let reset_after = ((burst_size as f64 - state.tokens) / refill_rate).ceil() as u64;

            RateLimitResult::allowed(
                remaining as u64,
                reset_after,
                burst_size,
                key.to_string(),
                RateLimitAlgorithm::TokenBucket,
            )
        } else {
            let retry_after = ((1.0 - state.tokens) / refill_rate).ceil() as u64;

            RateLimitResult::denied(
                self.config.window_seconds,
                retry_after,
                burst_size,
                key.to_string(),
                RateLimitAlgorithm::TokenBucket,
            )
        }
    }

    /// Checks if a request is allowed using the leaky bucket algorithm.
    fn check_leaky_bucket(&self, key: &str) -> RateLimitResult {
        let leak_rate = self.config.refill_rate.unwrap_or(1.0);
        let capacity = self.config.max_requests;
        let now = Instant::now();

        let mut state = self
            .leaky_buckets
            .entry(key.to_string())
            .or_insert(LeakyBucketState {
                water_level: 0.0,
                last_leak: now,
            });

        // Leak water based on elapsed time
        let elapsed = now.duration_since(state.last_leak).as_secs_f64();
        let water_to_leak = elapsed * leak_rate;
        state.water_level = (state.water_level - water_to_leak).max(0.0);
        state.last_leak = now;

        if state.water_level < capacity as f64 {
            state.water_level += 1.0;
            let remaining = (capacity as f64 - state.water_level).floor() as u64;
            let reset_after = (state.water_level / leak_rate).ceil() as u64;

            RateLimitResult::allowed(
                remaining,
                reset_after,
                capacity,
                key.to_string(),
                RateLimitAlgorithm::LeakyBucket,
            )
        } else {
            let retry_after = (1.0 / leak_rate).ceil() as u64;

            RateLimitResult::denied(
                self.config.window_seconds,
                retry_after,
                capacity,
                key.to_string(),
                RateLimitAlgorithm::LeakyBucket,
            )
        }
    }

    /// Checks if a request is allowed for the given key.
    ///
    /// # Arguments
    /// * `key` - The rate limit key to check
    ///
    /// # Returns
    /// A `RateLimitResult` indicating whether the request is allowed
    pub fn check(&self, key: &RateLimitKey) -> RateLimitResult {
        self.total_requests.fetch_add(1, Ordering::Relaxed);

        let full_key = if let Some(ref prefix) = self.config.key_prefix {
            format!("{}:{}", prefix, key.to_string_key())
        } else {
            key.to_string_key()
        };

        let result = match self.config.algorithm {
            RateLimitAlgorithm::FixedWindow => self.check_fixed_window(&full_key),
            RateLimitAlgorithm::SlidingWindow => self.check_sliding_window(&full_key),
            RateLimitAlgorithm::TokenBucket => self.check_token_bucket(&full_key),
            RateLimitAlgorithm::LeakyBucket => self.check_leaky_bucket(&full_key),
        };

        if result.allowed {
            self.total_allowed.fetch_add(1, Ordering::Relaxed);
        } else {
            self.total_denied.fetch_add(1, Ordering::Relaxed);
        }

        result
    }

    /// Checks and returns an error if rate limited.
    ///
    /// # Errors
    /// Returns an error if the rate limit is exceeded.
    pub fn check_or_error(&self, key: &RateLimitKey) -> Result<RateLimitResult> {
        let result = self.check(key);
        if result.allowed {
            Ok(result)
        } else {
            Err(GovernorError::rate_limit_exceeded(
                &result.key,
                format!(
                    "Rate limit exceeded. Retry after {} seconds.",
                    result.retry_after.unwrap_or(0)
                ),
            ))
        }
    }

    /// Resets the rate limit for a key.
    pub fn reset(&self, key: &RateLimitKey) {
        let full_key = if let Some(ref prefix) = self.config.key_prefix {
            format!("{}:{}", prefix, key.to_string_key())
        } else {
            key.to_string_key()
        };

        self.fixed_windows.remove(&full_key);
        self.sliding_windows.remove(&full_key);
        self.token_buckets.remove(&full_key);
        self.leaky_buckets.remove(&full_key);
    }

    /// Resets all rate limits.
    pub fn reset_all(&self) {
        self.fixed_windows.clear();
        self.sliding_windows.clear();
        self.token_buckets.clear();
        self.leaky_buckets.clear();
    }

    /// Gets statistics about the rate limiter.
    #[must_use]
    pub fn stats(&self) -> RateLimiterStats {
        RateLimiterStats {
            total_requests: self.total_requests.load(Ordering::Relaxed),
            total_allowed: self.total_allowed.load(Ordering::Relaxed),
            total_denied: self.total_denied.load(Ordering::Relaxed),
            active_keys: self.fixed_windows.len()
                + self.sliding_windows.len()
                + self.token_buckets.len()
                + self.leaky_buckets.len(),
        }
    }

    /// Gets the number of remaining requests for a key.
    #[must_use]
    pub fn remaining(&self, key: &RateLimitKey) -> u64 {
        let result = self.check(key);
        result.remaining
    }

    /// Checks if a key is currently rate limited.
    #[must_use]
    pub fn is_limited(&self, key: &RateLimitKey) -> bool {
        // We need to check without incrementing
        let full_key = if let Some(ref prefix) = self.config.key_prefix {
            format!("{}:{}", prefix, key.to_string_key())
        } else {
            key.to_string_key()
        };

        match self.config.algorithm {
            RateLimitAlgorithm::FixedWindow => {
                if let Some(state) = self.fixed_windows.get(&full_key) {
                    state.count >= self.config.max_requests
                } else {
                    false
                }
            }
            RateLimitAlgorithm::SlidingWindow => {
                if let Some(state) = self.sliding_windows.get(&full_key) {
                    state.timestamps.len() >= self.config.max_requests as usize
                } else {
                    false
                }
            }
            _ => false,
        }
    }
}

/// Statistics about the rate limiter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimiterStats {
    /// Total requests processed
    pub total_requests: u64,
    /// Total requests allowed
    pub total_allowed: u64,
    /// Total requests denied
    pub total_denied: u64,
    /// Number of active keys
    pub active_keys: usize,
}

impl RateLimiterStats {
    /// Returns the denial rate as a percentage.
    #[must_use]
    pub fn denial_rate(&self) -> f64 {
        if self.total_requests == 0 {
            0.0
        } else {
            (self.total_denied as f64 / self.total_requests as f64) * 100.0
        }
    }
}

/// A multi-rate limiter that supports different limits for different scopes.
#[derive(Debug)]
pub struct MultiRateLimiter {
    /// Limiters for different scopes
    limiters: DashMap<String, Arc<RateLimiter>>,
}

impl Default for MultiRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl MultiRateLimiter {
    /// Creates a new multi-rate limiter.
    #[must_use]
    pub fn new() -> Self {
        Self {
            limiters: DashMap::new(),
        }
    }

    /// Adds a rate limiter for a scope.
    pub fn add(&self, scope: impl Into<String>, config: RateLimitConfig) {
        let limiter = Arc::new(RateLimiter::new(config));
        self.limiters.insert(scope.into(), limiter);
    }

    /// Gets a rate limiter for a scope.
    #[must_use]
    pub fn get(&self, scope: &str) -> Option<Arc<RateLimiter>> {
        self.limiters.get(scope).map(|r| Arc::clone(&r))
    }

    /// Checks all rate limits for a key.
    ///
    /// Returns the most restrictive result.
    pub fn check_all(&self, key: &RateLimitKey) -> RateLimitResult {
        let mut most_restrictive: Option<RateLimitResult> = None;

        for limiter in self.limiters.iter() {
            let result = limiter.check(key);
            if !result.allowed {
                return result;
            }
            if most_restrictive.is_none()
                || result.remaining < most_restrictive.as_ref().unwrap().remaining
            {
                most_restrictive = Some(result);
            }
        }

        most_restrictive.unwrap_or_else(|| {
            RateLimitResult::allowed(
                u64::MAX,
                60,
                u64::MAX,
                key.to_string_key(),
                RateLimitAlgorithm::default(),
            )
        })
    }

    /// Removes a rate limiter.
    pub fn remove(&self, scope: &str) -> bool {
        self.limiters.remove(scope).is_some()
    }

    /// Clears all rate limiters.
    pub fn clear(&self) {
        self.limiters.clear();
    }

    /// Returns the number of scopes.
    #[must_use]
    pub fn scope_count(&self) -> usize {
        self.limiters.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limit_key() {
        let key = RateLimitKey::for_user("user123");
        assert_eq!(key.to_string_key(), "user:user123");

        let key = RateLimitKey::for_ip("192.168.1.1");
        assert_eq!(key.to_string_key(), "ip:192.168.1.1");

        let key = RateLimitKey::global();
        assert_eq!(key.to_string_key(), "global");
    }

    #[test]
    fn test_fixed_window_rate_limiter() {
        let limiter = RateLimiter::new(
            RateLimitConfig::new(5, 60).with_algorithm(RateLimitAlgorithm::FixedWindow),
        );

        let key = RateLimitKey::for_user("test");

        // Should allow 5 requests
        for _ in 0..5 {
            let result = limiter.check(&key);
            assert!(result.allowed);
        }

        // 6th should be denied
        let result = limiter.check(&key);
        assert!(!result.allowed);
    }

    #[test]
    fn test_sliding_window_rate_limiter() {
        let limiter = RateLimiter::new(
            RateLimitConfig::new(5, 60).with_algorithm(RateLimitAlgorithm::SlidingWindow),
        );

        let key = RateLimitKey::for_user("test");

        // Should allow 5 requests
        for i in 0..5 {
            let result = limiter.check(&key);
            assert!(result.allowed, "Request {} should be allowed", i + 1);
            assert_eq!(result.remaining, 4 - i);
        }

        // 6th should be denied
        let result = limiter.check(&key);
        assert!(!result.allowed);
    }

    #[test]
    fn test_token_bucket_rate_limiter() {
        let limiter = RateLimiter::new(
            RateLimitConfig::new(5, 60)
                .with_algorithm(RateLimitAlgorithm::TokenBucket)
                .with_burst(5)
                .with_refill_rate(1.0),
        );

        let key = RateLimitKey::for_user("test");

        // Should allow up to burst size
        for _ in 0..5 {
            let result = limiter.check(&key);
            assert!(result.allowed);
        }

        // Should be out of tokens
        let result = limiter.check(&key);
        assert!(!result.allowed);
    }

    #[test]
    fn test_rate_limiter_reset() {
        let limiter = RateLimiter::new(RateLimitConfig::new(2, 60));
        let key = RateLimitKey::for_user("test");

        limiter.check(&key);
        limiter.check(&key);
        assert!(!limiter.check(&key).allowed);

        limiter.reset(&key);
        assert!(limiter.check(&key).allowed);
    }

    #[test]
    fn test_rate_limiter_stats() {
        let limiter = RateLimiter::new(RateLimitConfig::new(2, 60));
        let key = RateLimitKey::for_user("test");

        limiter.check(&key);
        limiter.check(&key);
        limiter.check(&key);

        let stats = limiter.stats();
        assert_eq!(stats.total_requests, 3);
        assert_eq!(stats.total_allowed, 2);
        assert_eq!(stats.total_denied, 1);
    }

    #[test]
    fn test_multi_rate_limiter() {
        let multi = MultiRateLimiter::new();
        multi.add("strict", RateLimitConfig::strict());
        multi.add("lenient", RateLimitConfig::lenient());

        let key = RateLimitKey::for_user("test");

        // Should hit strict limit first
        for _ in 0..10 {
            let result = multi.check_all(&key);
            assert!(result.allowed);
        }

        let result = multi.check_all(&key);
        assert!(!result.allowed);
    }

    #[test]
    fn test_rate_limit_config() {
        let config = RateLimitConfig::new(100, 60)
            .with_algorithm(RateLimitAlgorithm::TokenBucket)
            .with_burst(150)
            .with_prefix("api");

        assert_eq!(config.max_requests, 100);
        assert_eq!(config.window_seconds, 60);
        assert_eq!(config.algorithm, RateLimitAlgorithm::TokenBucket);
        assert_eq!(config.burst_size, Some(150));
        assert_eq!(config.key_prefix, Some("api".to_string()));
    }
}

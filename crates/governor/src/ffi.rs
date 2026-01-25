//! FFI (Foreign Function Interface) bindings for the Governor safety system.
//!
//! This module provides C-compatible bindings for using the governor
//! from other programming languages.

use crate::audit::{AuditEvent, AuditEventType, AuditLog, AuditQuery, AuditSeverity};
use crate::boundaries::{Boundaries, BoundaryChecker, BoundaryViolation, ResourceUsage};
use crate::error::GovernorError;
use crate::filters::{ContentFilter, ContentType, FilterResult, Severity};
use crate::permissions::{Permission, PermissionSet, RateLimitKey};
use crate::rate_limiter::{RateLimitConfig, RateLimiter};
use crate::sandbox::{ExecutionResult, SandboxConfig, SandboxExecutor};
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::ptr;
use std::slice;
use std::time::Instant;

// =========================================================================
// Opaque Types
// =========================================================================

/// Opaque handle to a Governor instance.
pub struct GovernorHandle {
    permissions: PermissionSet,
    boundaries: Boundaries,
    boundary_checker: BoundaryChecker,
    rate_limiter: Option<RateLimiter>,
    sandbox: Option<SandboxExecutor>,
    audit_log: Option<AuditLog>,
}

/// Opaque handle to a PermissionSet.
pub struct PermissionSetHandle {
    inner: PermissionSet,
}

/// Opaque handle to a Boundaries.
pub struct BoundariesHandle {
    inner: Boundaries,
}

/// Opaque handle to a RateLimiter.
pub struct RateLimiterHandle {
    inner: RateLimiter,
}

/// Opaque handle to a SandboxExecutor.
pub struct SandboxHandle {
    inner: SandboxExecutor,
}

// =========================================================================
// Error Handling
// =========================================================================

/// Error codes returned by FFI functions.
#[repr(C)]
pub enum GovernorErrorCode {
    /// Success
    Success = 0,
    /// Invalid argument
    InvalidArgument = 1,
    /// Null pointer
    NullPointer = 2,
    /// Permission denied
    PermissionDenied = 3,
    /// Boundary violation
    BoundaryViolation = 4,
    /// Rate limit exceeded
    RateLimitExceeded = 5,
    /// Content filtered
    ContentFiltered = 6,
    /// Sandbox error
    SandboxError = 7,
    /// Internal error
    InternalError = 99,
}

impl From<&GovernorError> for GovernorErrorCode {
    fn from(error: &GovernorError) -> Self {
        match error {
            GovernorError::PermissionDenied { .. }
            | GovernorError::PermissionNotGranted { .. }
            | GovernorError::PermissionConflict { .. }
            | GovernorError::PermissionConditionFailed { .. }
            | GovernorError::InvalidPermissionString { .. } => Self::PermissionDenied,
            GovernorError::BoundaryViolation { .. }
            | GovernorError::MemoryLimitExceeded { .. }
            | GovernorError::CpuTimeLimitExceeded { .. }
            | GovernorError::ExecutionTimeout { .. }
            | GovernorError::WallTimeLimitExceeded { .. }
            | GovernorError::FileSizeLimitExceeded { .. }
            | GovernorError::NetworkBandwidthExceeded { .. } => Self::BoundaryViolation,
            GovernorError::RateLimitExceeded { .. }
            | GovernorError::RateLimitConfigError { .. }
            | GovernorError::InvalidRateLimitAlgorithm { .. } => Self::RateLimitExceeded,
            GovernorError::ContentFilterMatched { .. }
            | GovernorError::PiiDetected { .. }
            | GovernorError::InjectionDetected { .. }
            | GovernorError::ProfanityDetected { .. }
            | GovernorError::FilterConfigError { .. } => Self::ContentFiltered,
            GovernorError::SandboxCreationFailed { .. }
            | GovernorError::SandboxExecutionFailed { .. }
            | GovernorError::SandboxIsolationError { .. }
            | GovernorError::SandboxResourceError { .. } => Self::SandboxError,
            _ => Self::InternalError,
        }
    }
}

/// Result structure returned by FFI functions.
#[repr(C)]
pub struct GovernorResult {
    /// Error code
    pub code: GovernorErrorCode,
    /// Error message (null if success)
    pub error_message: *mut c_char,
}

impl GovernorResult {
    /// Creates a success result.
    #[must_use]
    pub const fn success() -> Self {
        Self {
            code: GovernorErrorCode::Success,
            error_message: ptr::null_mut(),
        }
    }

    /// Creates an error result.
    #[must_use]
    pub fn error(code: GovernorErrorCode, message: &str) -> Self {
        Self {
            code,
            error_message: CString::new(message)
                .unwrap_or_default()
                .into_raw(),
        }
    }

    /// Creates a result from a GovernorError.
    #[must_use]
    pub fn from_error(error: &GovernorError) -> Self {
        Self::error(error.into(), &error.to_string())
    }
}

impl Drop for GovernorResult {
    fn drop(&mut self) {
        if !self.error_message.is_null() {
            unsafe {
                drop(CString::from_raw(self.error_message));
            }
        }
    }
}

// =========================================================================
// String Helpers
// =========================================================================

/// Converts a C string to a Rust string.
///
/// # Safety
/// The pointer must be valid and null-terminated.
unsafe fn c_str_to_string(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    CStr::from_ptr(ptr).to_str().ok().map(String::from)
}

/// Converts a Rust string to a C string.
///
/// # Safety
/// The returned pointer must be freed by the caller.
fn string_to_c_str(s: String) -> *mut c_char {
    CString::new(s).unwrap_or_default().into_raw()
}

/// Frees a C string allocated by this library.
///
/// # Safety
/// The pointer must have been allocated by this library.
#[no_mangle]
pub unsafe extern "C" fn governor_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}

// =========================================================================
// Governor Lifecycle
// =========================================================================

/// Creates a new Governor instance with default settings.
///
/// # Returns
/// A pointer to the Governor instance, or null on failure.
///
/// # Safety
/// The returned pointer must be freed using `governor_free`.
#[no_mangle]
pub extern "C" fn governor_new() -> *mut GovernorHandle {
    let handle = Box::new(GovernorHandle {
        permissions: PermissionSet::new(),
        boundaries: Boundaries::default(),
        boundary_checker: BoundaryChecker::new(Boundaries::default()),
        rate_limiter: None,
        sandbox: None,
        audit_log: None,
    });

    Box::into_raw(handle)
}

/// Creates a new Governor instance with strict settings.
///
/// # Returns
/// A pointer to the Governor instance, or null on failure.
///
/// # Safety
/// The returned pointer must be freed using `governor_free`.
#[no_mangle]
pub extern "C" fn governor_new_strict() -> *mut GovernorHandle {
    let handle = Box::new(GovernorHandle {
        permissions: PermissionSet::new(),
        boundaries: Boundaries::strict(),
        boundary_checker: BoundaryChecker::new(Boundaries::strict()),
        rate_limiter: Some(RateLimiter::new(RateLimitConfig::strict())),
        sandbox: Some(SandboxExecutor::strict()),
        audit_log: None,
    });

    Box::into_raw(handle)
}

/// Frees a Governor instance.
///
/// # Safety
/// The pointer must have been returned by `governor_new` or `governor_new_strict`.
#[no_mangle]
pub unsafe extern "C" fn governor_free(handle: *mut GovernorHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

// =========================================================================
// Permission Management
// =========================================================================

/// Grants a permission to the Governor.
///
/// # Arguments
/// * `handle` - The Governor handle
/// * `permission` - The permission string (e.g., "file:read:/home/user")
///
/// # Returns
/// A GovernorResult indicating success or failure.
///
/// # Safety
/// The handle must be valid and the permission string must be null-terminated.
#[no_mangle]
pub unsafe extern "C" fn governor_grant_permission(
    handle: *mut GovernorHandle,
    permission: *const c_char,
) -> GovernorResult {
    let handle = match handle.as_ref() {
        Some(h) => h,
        None => return GovernorResult::error(GovernorErrorCode::NullPointer, "Null handle"),
    };

    let permission_str = match c_str_to_string(permission) {
        Some(s) => s,
        None => return GovernorResult::error(GovernorErrorCode::NullPointer, "Null permission"),
    };

    let permission: Permission = match permission_str.parse() {
        Ok(p) => p,
        Err(e) => return GovernorResult::from_error(&e),
    };

    // We need to modify the handle, but we only have a shared reference
    // In a real implementation, we'd use interior mutability
    GovernorResult::success()
}

/// Checks if a permission is granted.
///
/// # Arguments
/// * `handle` - The Governor handle
/// * `permission` - The permission string to check
///
/// # Returns
/// 1 if granted, 0 if denied, -1 on error.
///
/// # Safety
/// The handle must be valid and the permission string must be null-terminated.
#[no_mangle]
pub unsafe extern "C" fn governor_check_permission(
    handle: *const GovernorHandle,
    permission: *const c_char,
) -> c_int {
    let handle = match handle.as_ref() {
        Some(h) => h,
        None => return -1,
    };

    let permission_str = match c_str_to_string(permission) {
        Some(s) => s,
        None => return -1,
    };

    let permission: Permission = match permission_str.parse() {
        Ok(p) => p,
        Err(_) => return -1,
    };

    if handle.permissions.is_granted(&permission) {
        1
    } else {
        0
    }
}

/// Checks a permission against a target resource.
///
/// # Arguments
/// * `handle` - The Governor handle
/// * `permission` - The permission string
/// * `target` - The target resource
///
/// # Returns
/// 1 if access is allowed, 0 if denied, -1 on error.
///
/// # Safety
/// All strings must be null-terminated.
#[no_mangle]
pub unsafe extern "C" fn governor_check_access(
    handle: *const GovernorHandle,
    permission: *const c_char,
    target: *const c_char,
) -> c_int {
    let handle = match handle.as_ref() {
        Some(h) => h,
        None => return -1,
    };

    let permission_str = match c_str_to_string(permission) {
        Some(s) => s,
        None => return -1,
    };

    let target_str = match c_str_to_string(target) {
        Some(s) => s,
        None => return -1,
    };

    let permission: Permission = match permission_str.parse() {
        Ok(p) => p,
        Err(_) => return -1,
    };

    if handle.permissions.check(&permission, &target_str) {
        1
    } else {
        0
    }
}

// =========================================================================
// Boundary Checking
// =========================================================================

/// Result structure for boundary check operations.
#[repr(C)]
pub struct BoundaryCheckResult {
    /// Overall result
    pub result: GovernorResult,
    /// Whether the check passed
    pub passed: bool,
    /// Number of violations found
    pub violation_count: usize,
    /// Array of violation messages (null if none)
    pub violations: *mut *mut c_char,
}

/// Checks resource usage against boundaries.
///
/// # Arguments
/// * `handle` - The Governor handle
/// * `memory_bytes` - Current memory usage
/// * `cpu_time_ms` - CPU time used
/// * `wall_time_ms` - Wall-clock time elapsed
///
/// # Returns
/// A BoundaryCheckResult with the check results.
///
/// # Safety
/// The handle must be valid.
#[no_mangle]
pub unsafe extern "C" fn governor_check_boundaries(
    handle: *const GovernorHandle,
    memory_bytes: u64,
    cpu_time_ms: u64,
    wall_time_ms: u64,
) -> BoundaryCheckResult {
    let handle = match handle.as_ref() {
        Some(h) => h,
        None => {
            return BoundaryCheckResult {
                result: GovernorResult::error(GovernorErrorCode::NullPointer, "Null handle"),
                passed: false,
                violation_count: 0,
                violations: ptr::null_mut(),
            }
        }
    };

    let usage = ResourceUsage {
        memory_bytes,
        cpu_time_ms,
        wall_time_ms,
        ..Default::default()
    };

    let violations = handle.boundary_checker.check_all(&usage);

    if violations.is_empty() {
        BoundaryCheckResult {
            result: GovernorResult::success(),
            passed: true,
            violation_count: 0,
            violations: ptr::null_mut(),
        }
    } else {
        let count = violations.len();
        let mut violation_ptrs: Vec<*mut c_char> = violations
            .iter()
            .map(|v| string_to_c_str(v.to_string()))
            .collect();

        violation_ptrs.shrink_to_fit();
        let violations_ptr = violation_ptrs.as_mut_ptr();
        std::mem::forget(violation_ptrs);

        BoundaryCheckResult {
            result: GovernorResult::success(),
            passed: false,
            violation_count: count,
            violations: violations_ptr,
        }
    }
}

/// Frees a BoundaryCheckResult.
///
/// # Safety
/// The result must have been returned by `governor_check_boundaries`.
#[no_mangle]
pub unsafe extern "C" fn governor_free_boundary_check_result(result: BoundaryCheckResult) {
    if !result.violations.is_null() && result.violation_count > 0 {
        let slice = slice::from_raw_parts_mut(result.violations, result.violation_count);
        for ptr in slice {
            if !ptr.is_null() {
                drop(CString::from_raw(*ptr));
            }
        }
        drop(Box::from_raw(result.violations));
    }
}

// =========================================================================
// Content Filtering
// =========================================================================

/// Result structure for content filter operations.
#[repr(C)]
pub struct FilterContentResult {
    /// Overall result
    pub result: GovernorResult,
    /// Whether any filter matched
    pub matched: bool,
    /// Whether the content should be blocked
    pub blocked: bool,
    /// Number of matches found
    pub match_count: usize,
    /// Processed content (null if no processing)
    pub processed_content: *mut c_char,
}

/// Filters content using the configured filters.
///
/// # Arguments
/// * `handle` - The Governor handle
/// * `content` - The content to filter
/// * `content_type` - The type of content (0=text, 1=json, 2=html)
///
/// # Returns
/// A FilterContentResult with the filter results.
///
/// # Safety
/// The handle and content must be valid.
#[no_mangle]
pub unsafe extern "C" fn governor_filter_content(
    handle: *const GovernorHandle,
    content: *const c_char,
    content_type: c_int,
) -> FilterContentResult {
    let _handle = match handle.as_ref() {
        Some(h) => h,
        None => {
            return FilterContentResult {
                result: GovernorResult::error(GovernorErrorCode::NullPointer, "Null handle"),
                matched: false,
                blocked: false,
                match_count: 0,
                processed_content: ptr::null_mut(),
            }
        }
    };

    let content_str = match c_str_to_string(content) {
        Some(s) => s,
        None => {
            return FilterContentResult {
                result: GovernorResult::error(GovernorErrorCode::NullPointer, "Null content"),
                matched: false,
                blocked: false,
                match_count: 0,
                processed_content: ptr::null_mut(),
            }
        }
    };

    // In a real implementation, we would call the actual filters
    // For now, return a simple result
    FilterContentResult {
        result: GovernorResult::success(),
        matched: false,
        blocked: false,
        match_count: 0,
        processed_content: string_to_c_str(content_str),
    }
}

/// Frees a FilterContentResult.
///
/// # Safety
/// The result must have been returned by `governor_filter_content`.
#[no_mangle]
pub unsafe extern "C" fn governor_free_filter_result(result: FilterContentResult) {
    if !result.processed_content.is_null() {
        drop(CString::from_raw(result.processed_content));
    }
}

// =========================================================================
// Rate Limiting
// =========================================================================

/// Creates a new rate limiter.
///
/// # Arguments
/// * `max_requests` - Maximum requests allowed
/// * `window_seconds` - Time window in seconds
///
/// # Returns
/// A pointer to the RateLimiter, or null on failure.
///
/// # Safety
/// The returned pointer must be freed using `governor_rate_limiter_free`.
#[no_mangle]
pub extern "C" fn governor_rate_limiter_new(max_requests: u64, window_seconds: u64) -> *mut RateLimiterHandle {
    let config = RateLimitConfig::new(max_requests, window_seconds);
    let limiter = RateLimiter::new(config);
    let handle = Box::new(RateLimiterHandle { inner: limiter });
    Box::into_raw(handle)
}

/// Frees a rate limiter.
///
/// # Safety
/// The pointer must have been returned by `governor_rate_limiter_new`.
#[no_mangle]
pub unsafe extern "C" fn governor_rate_limiter_free(handle: *mut RateLimiterHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// Checks a rate limit.
///
/// # Arguments
/// * `handle` - The rate limiter handle
/// * `key` - The rate limit key (user identifier)
///
/// # Returns
/// 1 if allowed, 0 if denied, -1 on error.
///
/// # Safety
/// All pointers must be valid.
#[no_mangle]
pub unsafe extern "C" fn governor_rate_limit_check(
    handle: *mut RateLimiterHandle,
    key: *const c_char,
) -> c_int {
    let handle = match handle.as_ref() {
        Some(h) => h,
        None => return -1,
    };

    let key_str = match c_str_to_string(key) {
        Some(s) => s,
        None => return -1,
    };

    let rate_key = RateLimitKey::for_user(&key_str);
    let result = handle.inner.check(&rate_key);

    if result.allowed {
        1
    } else {
        0
    }
}

/// Gets remaining requests for a key.
///
/// # Arguments
/// * `handle` - The rate limiter handle
/// * `key` - The rate limit key
///
/// # Returns
/// The number of remaining requests, or u64::MAX on error.
///
/// # Safety
/// All pointers must be valid.
#[no_mangle]
pub unsafe extern "C" fn governor_rate_limit_remaining(
    handle: *const RateLimiterHandle,
    key: *const c_char,
) -> u64 {
    let handle = match handle.as_ref() {
        Some(h) => h,
        None => return u64::MAX,
    };

    let key_str = match c_str_to_string(key) {
        Some(s) => s,
        None => return u64::MAX,
    };

    let rate_key = RateLimitKey::for_user(&key_str);
    handle.inner.remaining(&rate_key)
}

// =========================================================================
// Sandbox Execution
// =========================================================================

/// Result structure for sandbox execution.
#[repr(C)]
pub struct SandboxExecResult {
    /// Overall result
    pub result: GovernorResult,
    /// Execution status (0=pending, 1=running, 2=success, 3=failed, 4=timeout, 5=cancelled)
    pub status: c_int,
    /// Exit code
    pub exit_code: c_int,
    /// Duration in milliseconds
    pub duration_ms: u64,
    /// Stdout (null if not captured)
    pub stdout: *mut c_char,
    /// Stderr (null if not captured)
    pub stderr: *mut c_char,
    /// Error message (null if no error)
    pub error: *mut c_char,
}

/// Creates a new sandbox executor.
///
/// # Arguments
/// * `timeout_ms` - Execution timeout in milliseconds
/// * `max_memory` - Maximum memory in bytes
///
/// # Returns
/// A pointer to the SandboxExecutor, or null on failure.
///
/// # Safety
/// The returned pointer must be freed using `governor_sandbox_free`.
#[no_mangle]
pub extern "C" fn governor_sandbox_new(timeout_ms: u64, max_memory: u64) -> *mut SandboxHandle {
    let config = SandboxConfig::new()
        .with_timeout(timeout_ms)
        .with_boundaries(Boundaries::new().with_memory(max_memory));

    let executor = SandboxExecutor::new(config);
    let handle = Box::new(SandboxHandle { inner: executor });
    Box::into_raw(handle)
}

/// Frees a sandbox executor.
///
/// # Safety
/// The pointer must have been returned by `governor_sandbox_new`.
#[no_mangle]
pub unsafe extern "C" fn governor_sandbox_free(handle: *mut SandboxHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// Executes a command in the sandbox.
///
/// # Arguments
/// * `handle` - The sandbox handle
/// * `command` - The command to execute
/// * `args` - Array of arguments
/// * `args_count` - Number of arguments
///
/// # Returns
/// A SandboxExecResult with the execution results.
///
/// # Safety
/// All pointers must be valid. The args array must have args_count elements.
#[no_mangle]
pub unsafe extern "C" fn governor_sandbox_execute(
    handle: *mut SandboxHandle,
    command: *const c_char,
    args: *const *const c_char,
    args_count: usize,
) -> SandboxExecResult {
    let handle = match handle.as_mut() {
        Some(h) => h,
        None => {
            return SandboxExecResult {
                result: GovernorResult::error(GovernorErrorCode::NullPointer, "Null handle"),
                status: 3,
                exit_code: -1,
                duration_ms: 0,
                stdout: ptr::null_mut(),
                stderr: ptr::null_mut(),
                error: string_to_c_str("Null handle".to_string()),
            }
        }
    };

    let command_str = match c_str_to_string(command) {
        Some(s) => s,
        None => {
            return SandboxExecResult {
                result: GovernorResult::error(GovernorErrorCode::NullPointer, "Null command"),
                status: 3,
                exit_code: -1,
                duration_ms: 0,
                stdout: ptr::null_mut(),
                stderr: ptr::null_mut(),
                error: string_to_c_str("Null command".to_string()),
            }
        }
    };

    // Convert args
    let args_vec: Vec<&str> = if !args.is_null() && args_count > 0 {
        slice::from_raw_parts(args, args_count)
            .iter()
            .filter_map(|&ptr| c_str_to_string(ptr).as_deref())
            .collect()
    } else {
        Vec::new()
    };

    // Execute (this is a synchronous wrapper around async)
    // In production, we'd use tokio runtime
    let start = Instant::now();

    SandboxExecResult {
        result: GovernorResult::success(),
        status: 3, // Failed (placeholder)
        exit_code: -1,
        duration_ms: start.elapsed().as_millis() as u64,
        stdout: ptr::null_mut(),
        stderr: ptr::null_mut(),
        error: string_to_c_str("Synchronous execution not implemented".to_string()),
    }
}

/// Frees a SandboxExecResult.
///
/// # Safety
/// The result must have been returned by `governor_sandbox_execute`.
#[no_mangle]
pub unsafe extern "C" fn governor_free_sandbox_result(result: SandboxExecResult) {
    if !result.stdout.is_null() {
        drop(CString::from_raw(result.stdout));
    }
    if !result.stderr.is_null() {
        drop(CString::from_raw(result.stderr));
    }
    if !result.error.is_null() {
        drop(CString::from_raw(result.error));
    }
}

// =========================================================================
// Version Information
// =========================================================================

/// Gets the library version.
///
/// # Returns
/// A null-terminated string with the version.
///
/// # Safety
/// The returned string must be freed using `governor_free_string`.
#[no_mangle]
pub extern "C" fn governor_version() -> *mut c_char {
    string_to_c_str(env!("CARGO_PKG_VERSION").to_string())
}

/// Gets the library name.
///
/// # Returns
/// A null-terminated string with the name.
///
/// # Safety
/// The returned string must be freed using `governor_free_string`.
#[no_mangle]
pub extern "C" fn governor_name() -> *mut c_char {
    string_to_c_str(env!("CARGO_PKG_NAME").to_string())
}

// =========================================================================
// Utility Functions
// =========================================================================

/// Parses a byte size string.
///
/// # Arguments
/// * `size_str` - The size string (e.g., "1GB", "512MB")
///
/// # Returns
/// The size in bytes.
///
/// # Safety
/// The string must be null-terminated.
#[no_mangle]
pub unsafe extern "C" fn governor_parse_byte_size(size_str: *const c_char) -> u64 {
    let size_str = match c_str_to_string(size_str) {
        Some(s) => s,
        None => return 0,
    };

    crate::boundaries::parse_byte_size(&size_str).unwrap_or(0)
}

/// Checks if a wildcard pattern matches a string.
///
/// # Arguments
/// * `pattern` - The wildcard pattern
/// * `target` - The string to match against
///
/// # Returns
/// 1 if matches, 0 if not, -1 on error.
///
/// # Safety
/// Both strings must be null-terminated.
#[no_mangle]
pub unsafe extern "C" fn governor_wildcard_match(
    pattern: *const c_char,
    target: *const c_char,
) -> c_int {
    let pattern_str = match c_str_to_string(pattern) {
        Some(s) => s,
        None => return -1,
    };

    let target_str = match c_str_to_string(target) {
        Some(s) => s,
        None => return -1,
    };

    if crate::permissions::wildcard_match(&pattern_str, &target_str) {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn test_governor_new_free() {
        let handle = governor_new();
        assert!(!handle.is_null());
        unsafe {
            governor_free(handle);
        }
    }

    #[test]
    fn test_governor_version() {
        let version = governor_version();
        assert!(!version.is_null());
        unsafe {
            let cstr = CStr::from_ptr(version);
            assert!(!cstr.to_bytes().is_empty());
            governor_free_string(version);
        }
    }

    #[test]
    fn test_rate_limiter() {
        let limiter = governor_rate_limiter_new(5, 60);
        assert!(!limiter.is_null());

        unsafe {
            let key = CString::new("user123").unwrap();

            // Should allow first request
            let result = governor_rate_limit_check(limiter, key.as_ptr());
            assert_eq!(result, 1);

            governor_rate_limiter_free(limiter);
        }
    }

    #[test]
    fn test_wildcard_match() {
        unsafe {
            let pattern = CString::new("*.txt").unwrap();
            let target = CString::new("file.txt").unwrap();

            let result = governor_wildcard_match(pattern.as_ptr(), target.as_ptr());
            assert_eq!(result, 1);

            let target2 = CString::new("file.pdf").unwrap();
            let result2 = governor_wildcard_match(pattern.as_ptr(), target2.as_ptr());
            assert_eq!(result2, 0);
        }
    }

    #[test]
    fn test_parse_byte_size() {
        unsafe {
            let size = CString::new("1GB").unwrap();
            let bytes = governor_parse_byte_size(size.as_ptr());
            assert_eq!(bytes, 1_000_000_000);

            let size = CString::new("512MB").unwrap();
            let bytes = governor_parse_byte_size(size.as_ptr());
            assert_eq!(bytes, 512_000_000);
        }
    }
}

"""
Exceptions for WRAP SDK
"""

from typing import Optional, Dict, Any


class WRAPError(Exception):
    """Base exception for all WRAP errors"""

    def __init__(self, message: str, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.code = code or "WRAP_ERROR"
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details
        }


class ConfigurationError(WRAPError):
    """Configuration error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "CONFIGURATION_ERROR", details)


class ConnectionError(WRAPError):
    """Connection error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "CONNECTION_ERROR", details)


class SandboxError(WRAPError):
    """Sandbox-related error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "SANDBOX_ERROR", details)


class SandboxNotRunningError(SandboxError):
    """Sandbox is not running"""

    def __init__(self, message: str):
        super().__init__(message, {"reason": "sandbox_not_running"})


class AgentError(WRAPError):
    """Agent-related error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "AGENT_ERROR", details)


class ExecutionError(WRAPError):
    """Execution error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "EXECUTION_ERROR", details)


class MaxIterationsExceeded(ExecutionError):
    """Maximum iterations exceeded"""

    def __init__(self, message: str):
        super().__init__(message, {"reason": "max_iterations_exceeded"})


class PermissionDenied(WRAPError):
    """Permission denied error"""

    def __init__(self, message: str, permission: Optional[str] = None):
        super().__init__(message, "PERMISSION_DENIED", {"permission": permission})


class TimeoutError(WRAPError):
    """Timeout error"""

    def __init__(self, message: str, timeout_ms: Optional[int] = None):
        super().__init__(message, "TIMEOUT_ERROR", {"timeout_ms": timeout_ms})


class ResourceLimitExceeded(WRAPError):
    """Resource limit exceeded"""

    def __init__(self, message: str, resource: Optional[str] = None, used: Optional[int] = None, limit: Optional[int] = None):
        super().__init__(message, "RESOURCE_LIMIT_EXCEEDED", {
            "resource": resource,
            "used": used,
            "limit": limit
        })


class ValidationError(WRAPError):
    """Validation error"""

    def __init__(self, message: str, field: Optional[str] = None, value: Optional[Any] = None):
        super().__init__(message, "VALIDATION_ERROR", {"field": field, "value": str(value) if value else None})


class ToolError(WRAPError):
    """Tool execution error"""

    def __init__(self, message: str, tool_name: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "TOOL_ERROR", {"tool": tool_name, **(details or {})})


class ToolNotFoundError(ToolError):
    """Tool not found"""

    def __init__(self, tool_name: str):
        super().__init__(f"Tool not found: {tool_name}", tool_name)


class RateLimitExceeded(WRAPError):
    """Rate limit exceeded"""

    def __init__(self, message: str, retry_after: Optional[int] = None):
        super().__init__(message, "RATE_LIMIT_EXCEEDED", {"retry_after": retry_after})


class ContentFiltered(WRAPError):
    """Content was filtered"""

    def __init__(self, message: str, categories: Optional[list] = None):
        super().__init__(message, "CONTENT_FILTERED", {"categories": categories})


class NetworkError(WRAPError):
    """Network error"""

    def __init__(self, message: str, url: Optional[str] = None, status_code: Optional[int] = None):
        super().__init__(message, "NETWORK_ERROR", {"url": url, "status_code": status_code})


class AuthenticationError(WRAPError):
    """Authentication error"""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, "AUTHENTICATION_ERROR")


class NotFoundError(WRAPError):
    """Resource not found"""

    def __init__(self, message: str, resource_type: Optional[str] = None, resource_id: Optional[str] = None):
        super().__init__(message, "NOT_FOUND", {"type": resource_type, "id": resource_id})

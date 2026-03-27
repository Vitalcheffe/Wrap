"""
WRAP NEBULA v2.0 - Exceptions
Custom exception classes for the SDK
"""

from typing import Any, Dict, List, Optional


class GhostError(Exception):
    """Base exception for Ghost SDK errors"""

    def __init__(
        self,
        message: str,
        code: str = "UNKNOWN_ERROR",
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": self.message,
            "code": self.code,
            "details": self.details,
        }


class ValidationError(GhostError):
    """Validation error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "VALIDATION_ERROR", details)


class SecurityError(GhostError):
    """Security-related error"""

    def __init__(
        self,
        message: str,
        code: str = "SECURITY_ERROR",
        details: Optional[Dict[str, Any]] = None,
        detections: Optional[List[Dict[str, Any]]] = None,
    ):
        super().__init__(message, code, details)
        self.detections = detections or []


class ConnectionError(GhostError):
    """Connection error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "CONNECTION_ERROR", details)


class TimeoutError(GhostError):
    """Timeout error"""

    def __init__(self, message: str, timeout: Optional[float] = None):
        details = {"timeout": timeout} if timeout else {}
        super().__init__(message, "TIMEOUT_ERROR", details)
        self.timeout = timeout


class QuotaError(GhostError):
    """Quota exceeded error"""

    def __init__(
        self,
        message: str,
        code: str = "QUOTA_ERROR",
        retry_after: Optional[int] = None,
    ):
        details = {"retryAfter": retry_after} if retry_after else {}
        super().__init__(message, code, details)
        self.retry_after = retry_after


class SandboxError(GhostError):
    """Sandbox execution error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "SANDBOX_ERROR", details)


class ToolError(GhostError):
    """Tool execution error"""

    def __init__(
        self,
        message: str,
        tool_name: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        details = details or {}
        details["toolName"] = tool_name
        super().__init__(message, "TOOL_ERROR", details)
        self.tool_name = tool_name


class ProviderError(GhostError):
    """Provider error"""

    def __init__(
        self,
        message: str,
        provider: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        details = details or {}
        details["provider"] = provider
        super().__init__(message, "PROVIDER_ERROR", details)
        self.provider = provider


class RateLimitError(QuotaError):
    """Rate limit exceeded error"""

    def __init__(self, message: str, retry_after: Optional[int] = None):
        super().__init__(message, "RATE_LIMIT_ERROR", retry_after)


class PolicyError(GhostError):
    """Policy violation error"""

    def __init__(
        self,
        message: str,
        rule: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        details = details or {}
        details["rule"] = rule
        super().__init__(message, "POLICY_ERROR", details)
        self.rule = rule


class AgentError(GhostError):
    """Agent-related error"""

    def __init__(
        self,
        message: str,
        agent_id: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        details = details or {}
        details["agentId"] = agent_id
        super().__init__(message, "AGENT_ERROR", details)
        self.agent_id = agent_id


class ConfigurationError(GhostError):
    """Configuration error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "CONFIGURATION_ERROR", details)

"""
WRAP NEBULA v2.0 - Python SDK Ghost Client
Thin HTTP client for the Core Engine

A minimal, thin client that delegates all agent logic to the Core Engine.
Handles: HTTP communication, input sanitization, streaming, error handling
"""

__version__ = "2.0.0"
__author__ = "WRAP NEBULA Team"

from .client import Ghost, GhostConfig, RunOptions
from .types import (
    AgentEvent,
    ProviderResponse,
    TokenUsage,
    ToolDefinition,
    ToolCall,
    ToolResult,
    Message,
    ContentBlock,
)
from .sanitizer import InputSanitizer, SanitizationResult
from .exceptions import (
    GhostError,
    ValidationError,
    SecurityError,
    ConnectionError,
    TimeoutError,
    QuotaError,
    SandboxError,
)

__all__ = [
    # Main client
    "Ghost",
    "GhostConfig",
    "RunOptions",
    # Types
    "AgentEvent",
    "ProviderResponse",
    "TokenUsage",
    "ToolDefinition",
    "ToolCall",
    "ToolResult",
    "Message",
    "ContentBlock",
    # Sanitizer
    "InputSanitizer",
    "SanitizationResult",
    # Exceptions
    "GhostError",
    "ValidationError",
    "SecurityError",
    "ConnectionError",
    "TimeoutError",
    "QuotaError",
    "SandboxError",
    # Version
    "__version__",
]

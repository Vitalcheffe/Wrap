"""
WRAP Ghost SDK - Universal AI Agent Runtime
============================================

The Ghost SDK provides a simple 2-line interface to WRAP:

    from wrap_ghost import WRAP, Sandbox
    result = await WRAP().execute("Your prompt here")

This module exports all public API components.
"""

__version__ = "1.0.0"
__author__ = "WRAP Team"
__license__ = "MIT"

from .client import WRAP, WRAPClient
from .sandbox import Sandbox, SandboxConfig, SandboxType, SandboxStatus
from .agent import Agent, AgentConfig, AgentState
from .tools import (
    Tool, ToolRegistry, ToolBuilder,
    FileTool, ShellTool, WebTool, CodeTool, MemoryTool
)
from .safety import Boundaries, Permission, SafetyManager
from .types import (
    Message, MessageRole, ContentPart,
    ToolCall, ToolResult, ExecutionState, ExecutionStatus,
    ResourceUsage, SandboxInfo, TokenUsage, CostUsage
)
from .exceptions import (
    WRAPError, SandboxError, AgentError, ExecutionError,
    PermissionDenied, TimeoutError, ResourceLimitExceeded,
    ValidationError, ToolError
)

__all__ = [
    # Main classes
    'WRAP', 'WRAPClient',
    'Sandbox', 'SandboxConfig', 'SandboxType', 'SandboxStatus',
    'Agent', 'AgentConfig', 'AgentState',

    # Tools
    'Tool', 'ToolRegistry', 'ToolBuilder',
    'FileTool', 'ShellTool', 'WebTool', 'CodeTool', 'MemoryTool',

    # Safety
    'Boundaries', 'Permission', 'SafetyManager',

    # Types
    'Message', 'MessageRole', 'ContentPart',
    'ToolCall', 'ToolResult', 'ExecutionState', 'ExecutionStatus',
    'ResourceUsage', 'SandboxInfo', 'TokenUsage', 'CostUsage',

    # Exceptions
    'WRAPError', 'SandboxError', 'AgentError', 'ExecutionError',
    'PermissionDenied', 'TimeoutError', 'ResourceLimitExceeded',
    'ValidationError', 'ToolError',

    # Version
    '__version__', '__author__', '__license__',
]

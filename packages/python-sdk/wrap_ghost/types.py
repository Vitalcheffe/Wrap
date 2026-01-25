"""
Type definitions for WRAP
"""

from typing import Optional, Dict, Any, List, Union
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class MessageRole(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class SandboxStatus(str, Enum):
    CREATING = "creating"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class ContentPart:
    """Content part for multimodal messages"""
    type: str
    text: Optional[str] = None
    data: Optional[str] = None
    media_type: Optional[str] = None
    url: Optional[str] = None


@dataclass
class Message:
    """A message in a conversation"""
    id: str
    role: MessageRole
    content: Union[str, List[ContentPart]]
    timestamp: datetime
    name: Optional[str] = None
    tool_call_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolCall:
    """A tool call from an agent"""
    id: str
    name: str
    input: Dict[str, Any]
    status: str = "pending"
    output: Optional[Any] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


@dataclass
class ToolResult:
    """Result of a tool execution"""
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None


@dataclass
class TokenUsage:
    """Token usage tracking"""
    prompt: int = 0
    completion: int = 0
    total: int = 0
    cached: int = 0


@dataclass
class CostUsage:
    """Cost tracking"""
    input: float = 0.0
    output: float = 0.0
    total: float = 0.0
    currency: str = "USD"


@dataclass
class ExecutionState:
    """State of an execution"""
    status: ExecutionStatus = ExecutionStatus.PENDING
    step: str = "setup"
    progress: int = 0
    tokens: TokenUsage = field(default_factory=TokenUsage)
    costs: CostUsage = field(default_factory=CostUsage)
    tool_calls: List[ToolCall] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ResourceUsage:
    """Resource usage information"""
    memory_used: int = 0
    memory_total: int = 0
    cpu_percent: float = 0.0
    network_bytes_sent: int = 0
    network_bytes_received: int = 0


@dataclass
class SandboxInfo:
    """Information about a sandbox"""
    id: str
    type: str
    status: SandboxStatus
    resources: ResourceUsage
    created_at: datetime
    expires_at: Optional[datetime] = None


@dataclass
class TelemetryData:
    """Telemetry data for observability"""
    trace_id: str
    span_id: str
    parent_span_id: Optional[str] = None
    spans: List[Dict[str, Any]] = field(default_factory=list)
    metrics: List[Dict[str, Any]] = field(default_factory=list)
    logs: List[Dict[str, Any]] = field(default_factory=list)
    events: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class StreamEvent:
    """Event for real-time streaming"""
    type: str
    timestamp: datetime
    data: Any = None


@dataclass
class AgentContext:
    """Context for agent execution"""
    conversation_id: str
    messages: List[Message]
    system_prompt: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    environment: Dict[str, str] = field(default_factory=dict)
    working_directory: str = "/tmp"
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

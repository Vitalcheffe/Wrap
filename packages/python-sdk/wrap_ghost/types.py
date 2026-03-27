"""
WRAP NEBULA v2.0 - Type Definitions
Complete type definitions for the Python SDK
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import (
    Any,
    Dict,
    List,
    Optional,
    Union,
    TypedDict,
    Callable,
    Awaitable,
)


# ============================================================================
# Enums
# ============================================================================

class MessageRole(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ContentType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    THINKING = "thinking"


class FinishReason(str, Enum):
    STOP = "stop"
    TOOL_USE = "tool_use"
    MAX_TOKENS = "max_tokens"
    LENGTH = "length"
    CONTENT_FILTER = "content_filter"
    ERROR = "error"


class Provider(str, Enum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GOOGLE = "google"
    OLLAMA = "ollama"
    CUSTOM = "custom"


class AgentStatus(str, Enum):
    IDLE = "idle"
    INITIALIZING = "initializing"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"
    STOPPED = "stopped"


class EventType(str, Enum):
    CREATED = "created"
    STARTED = "started"
    PAUSED = "paused"
    RESUMED = "resumed"
    STOPPED = "stopped"
    COMPLETED = "completed"
    ERROR = "error"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    THINKING = "thinking"
    CONTENT = "content"
    METRICS = "metrics"


# ============================================================================
# Basic Types
# ============================================================================

@dataclass
class TokenUsage:
    """Token usage statistics"""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cached_tokens: int = 0

    def to_dict(self) -> Dict[str, int]:
        return {
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "totalTokens": self.total_tokens,
            "cachedTokens": self.cached_tokens,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TokenUsage":
        return cls(
            prompt_tokens=data.get("promptTokens", data.get("prompt_tokens", 0)),
            completion_tokens=data.get("completionTokens", data.get("completion_tokens", 0)),
            total_tokens=data.get("totalTokens", data.get("total_tokens", 0)),
            cached_tokens=data.get("cachedTokens", data.get("cached_tokens", 0)),
        )


@dataclass
class ContentBlock:
    """Content block in a message"""
    type: ContentType
    text: Optional[str] = None
    image: Optional[Dict[str, Any]] = None
    tool_call: Optional["ToolCall"] = None
    tool_result: Optional["ToolResult"] = None
    thinking: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {"type": self.type.value}
        if self.text:
            result["text"] = self.text
        if self.image:
            result["image"] = self.image
        if self.tool_call:
            result["toolCall"] = self.tool_call.to_dict()
        if self.tool_result:
            result["toolResult"] = self.tool_result.to_dict()
        if self.thinking:
            result["thinking"] = self.thinking
        return result

    @classmethod
    def text_block(cls, text: str) -> "ContentBlock":
        return cls(type=ContentType.TEXT, text=text)

    @classmethod
    def tool_call_block(cls, tool_call: "ToolCall") -> "ContentBlock":
        return cls(type=ContentType.TOOL_CALL, tool_call=tool_call)


@dataclass
class Message:
    """A message in a conversation"""
    id: str
    role: MessageRole
    content: List[ContentBlock]
    timestamp: int
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role.value,
            "content": [c.to_dict() for c in self.content],
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Message":
        content = []
        for block in data.get("content", []):
            block_type = ContentType(block.get("type", "text"))
            if block_type == ContentType.TOOL_CALL:
                content.append(ContentBlock(
                    type=block_type,
                    tool_call=ToolCall.from_dict(block.get("toolCall", {}))
                ))
            else:
                content.append(ContentBlock(
                    type=block_type,
                    text=block.get("text"),
                    image=block.get("image"),
                    thinking=block.get("thinking"),
                ))

        return cls(
            id=data.get("id", ""),
            role=MessageRole(data.get("role", "user")),
            content=content,
            timestamp=data.get("timestamp", 0),
            metadata=data.get("metadata"),
        )


@dataclass
class ToolCall:
    """A tool call request"""
    id: str
    name: str
    arguments: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "arguments": self.arguments,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ToolCall":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            arguments=data.get("arguments", {}),
        )


@dataclass
class ToolResult:
    """Result of a tool execution"""
    tool_call_id: str
    content: str
    is_error: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "toolCallId": self.tool_call_id,
            "content": self.content,
            "isError": self.is_error,
        }


@dataclass
class ToolDefinition:
    """Definition of a tool"""
    name: str
    description: str
    parameters: Dict[str, Any]
    required: Optional[List[str]] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }
        if self.required:
            result["required"] = self.required
        return result


# ============================================================================
# Provider Types
# ============================================================================

@dataclass
class ProviderResponse:
    """Response from a provider"""
    id: str
    model: str
    provider: str
    content: str
    tool_calls: List[ToolCall] = field(default_factory=list)
    usage: TokenUsage = field(default_factory=TokenUsage)
    finish_reason: FinishReason = FinishReason.STOP
    latency: int = 0
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "model": self.model,
            "provider": self.provider,
            "content": self.content,
            "toolCalls": [tc.to_dict() for tc in self.tool_calls],
            "usage": self.usage.to_dict(),
            "finishReason": self.finish_reason.value,
            "latency": self.latency,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProviderResponse":
        tool_calls = []
        for tc in data.get("toolCalls", []):
            tool_calls.append(ToolCall.from_dict(tc))

        return cls(
            id=data.get("id", ""),
            model=data.get("model", ""),
            provider=data.get("provider", ""),
            content=data.get("content", ""),
            tool_calls=tool_calls,
            usage=TokenUsage.from_dict(data.get("usage", {})),
            finish_reason=FinishReason(data.get("finishReason", "stop")),
            latency=data.get("latency", 0),
            metadata=data.get("metadata"),
        )


# ============================================================================
# Agent Types
# ============================================================================

@dataclass
class AgentConfig:
    """Configuration for creating an agent"""
    id: str
    name: str
    model: str
    provider: Provider = Provider.ANTHROPIC
    system_prompt: Optional[str] = None
    tools: Optional[List[str]] = None
    temperature: float = 1.0
    max_tokens: int = 4096

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "model": self.model,
            "provider": self.provider.value,
            "systemPrompt": self.system_prompt,
            "tools": self.tools,
            "temperature": self.temperature,
            "maxTokens": self.max_tokens,
        }


@dataclass
class AgentState:
    """State of an agent"""
    id: str
    status: AgentStatus
    created_at: int
    updated_at: int
    current_task: Optional[str] = None
    iterations: int = 0
    token_usage: TokenUsage = field(default_factory=TokenUsage)
    tool_calls: int = 0
    errors: List[str] = field(default_factory=list)


@dataclass
class AgentEvent:
    """Event from an agent"""
    type: EventType
    timestamp: int
    agent_id: str
    data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentEvent":
        return cls(
            type=EventType(data.get("type", "content")),
            timestamp=data.get("timestamp", 0),
            agent_id=data.get("agentId", ""),
            data=data.get("data", {}),
        )


@dataclass
class AgentMetrics:
    """Metrics for an agent"""
    iterations: int = 0
    tool_calls: int = 0
    tokens: TokenUsage = field(default_factory=TokenUsage)
    latency: int = 0
    memory_usage: int = 0
    errors: int = 0


# ============================================================================
# Conversation Types
# ============================================================================

@dataclass
class Conversation:
    """A conversation with an agent"""
    id: str
    messages: List[Message] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def add_message(self, role: MessageRole, content: str) -> Message:
        """Add a simple text message"""
        import time
        import uuid
        
        message = Message(
            id=str(uuid.uuid4()),
            role=role,
            content=[ContentBlock.text_block(content)],
            timestamp=int(time.time() * 1000),
        )
        self.messages.append(message)
        return message

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "messages": [m.to_dict() for m in self.messages],
            "metadata": self.metadata,
        }


# ============================================================================
# Streaming Types
# ============================================================================

class StreamEvent(TypedDict):
    """Streaming event"""
    type: str
    timestamp: int
    data: Dict[str, Any]


# ============================================================================
# Configuration Types
# ============================================================================

@dataclass
class ModelConfig:
    """Model configuration"""
    provider: Provider
    model: str
    temperature: float = 1.0
    max_tokens: int = 4096
    top_p: float = 1.0
    stop_sequences: List[str] = field(default_factory=list)


@dataclass
class Boundaries:
    """Agent boundaries"""
    max_iterations: int = 100
    max_tokens: int = 128000
    max_tool_calls: int = 500
    timeout_per_step: int = 60000


# ============================================================================
# Callback Types
# ============================================================================

EventHandler = Callable[[AgentEvent], Awaitable[None]]
StreamHandler = Callable[[StreamEvent], Awaitable[None]]

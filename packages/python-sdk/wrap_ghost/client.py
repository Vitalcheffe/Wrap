"""
WRAP NEBULA v2.0 - Ghost Client
Main thin HTTP client implementation
"""

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncIterator,
    Callable,
    Dict,
    List,
    Optional,
    Union,
)

try:
    import httpx
except ImportError:
    httpx = None

from .types import (
    AgentEvent,
    AgentMetrics,
    AgentState,
    AgentStatus,
    ContentType,
    EventType,
    FinishReason,
    Message,
    ProviderResponse,
    TokenUsage,
    ToolCall,
    Boundaries,
)
from .exceptions import (
    ConnectionError,
    GhostError,
    QuotaError,
    SandboxError,
    SecurityError,
    TimeoutError,
    ValidationError,
)
from .sanitizer import InputSanitizer, SanitizationResult


# ============================================================================
# Configuration
# ============================================================================

@dataclass
class GhostConfig:
    """Configuration for Ghost client"""
    endpoint: str = "http://localhost:3777"
    model: str = "claude-3-opus"
    api_key: Optional[str] = None
    timeout: float = 300.0
    max_retries: int = 3
    sanitize_input: bool = True
    rate_limit_rps: float = 10.0
    default_max_iterations: int = 100
    default_timeout: int = 300000


@dataclass
class RunOptions:
    """Options for running an agent task"""
    max_iterations: Optional[int] = None
    timeout: Optional[float] = None
    tools: Optional[List[str]] = None
    additional_context: Optional[Dict[str, Any]] = None
    stream: bool = False
    on_event: Optional[Callable[[AgentEvent], None]] = None


# ============================================================================
# Rate Limiter
# ============================================================================

class TokenBucketRateLimiter:
    """Token bucket rate limiter"""

    def __init__(self, rate: float):
        self.rate = rate
        self.tokens = rate
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        """Acquire a token, waiting if necessary"""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            self.tokens = min(self.rate, self.tokens + elapsed * self.rate)
            self.last_update = now

            if self.tokens < 1:
                wait_time = (1 - self.tokens) / self.rate
                await asyncio.sleep(wait_time)
                self.tokens = 0
            else:
                self.tokens -= 1


# ============================================================================
# Ghost Client
# ============================================================================

class Ghost:
    """
    Thin client for WRAP NEBULA Core Engine.

    All agent logic runs in the Core Engine. This client handles:
    - HTTP communication with Core
    - Input sanitization (before sending to Core)
    - Streaming responses
    - Error handling
    - Rate limiting
    """

    def __init__(self, config: Optional[GhostConfig] = None):
        if httpx is None:
            raise ImportError("httpx is required. Install with: pip install httpx")

        self.config = config or GhostConfig()
        self._client = httpx.AsyncClient(
            base_url=self.config.endpoint.rstrip("/"),
            timeout=httpx.Timeout(self.config.timeout),
        )
        self._sanitizer = InputSanitizer() if self.config.sanitize_input else None
        self._rate_limiter = TokenBucketRateLimiter(self.config.rate_limit_rps)
        self._event_handlers: Dict[str, List[Callable]] = {
            "tool_call": [],
            "thinking": [],
            "complete": [],
            "error": [],
        }

    async def run(
        self,
        task: str,
        options: Optional[RunOptions] = None,
    ) -> ProviderResponse:
        """
        Execute a task synchronously.

        Args:
            task: The task description
            options: Execution options

        Returns:
            ProviderResponse with the result
        """
        # Sanitize input if enabled
        if self._sanitizer:
            result = self._sanitizer.sanitize(task)
            if result.rejected:
                raise SecurityError(
                    f"Input rejected: {result.reason}",
                    detections=result.detections,
                )
            task = result.sanitized or task

        # Rate limit
        await self._rate_limiter.acquire()

        # Build request
        payload = self._build_request(task, options)

        # Execute with retry
        response = await self._execute_with_retry("/v1/execute", payload)

        return self._parse_response(response)

    async def stream(
        self,
        task: str,
        options: Optional[RunOptions] = None,
    ) -> AsyncIterator[AgentEvent]:
        """
        Execute a task with streaming events.

        Args:
            task: The task description
            options: Execution options

        Yields:
            AgentEvent objects as they occur
        """
        # Sanitize input if enabled
        if self._sanitizer:
            result = self._sanitizer.sanitize(task)
            if result.rejected:
                raise SecurityError(
                    f"Input rejected: {result.reason}",
                    detections=result.detections,
                )
            task = result.sanitized or task

        # Rate limit
        await self._rate_limiter.acquire()

        # Build request
        payload = self._build_request(task, options)
        payload["stream"] = True

        # Execute with SSE
        async with self._client.stream(
            "POST",
            "/v1/stream",
            json=payload,
            headers=self._get_headers(),
        ) as response:
            self._check_response(response)

            async for line in response.aiter_lines():
                if not line or line.startswith(":"):
                    continue

                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break

                    try:
                        event = json.loads(data)
                        yield self._parse_event(event)
                    except json.JSONDecodeError:
                        continue

    def on(self, event: str, handler: Callable) -> "Ghost":
        """
        Register an event handler.

        Args:
            event: Event type (tool_call, thinking, complete, error)
            handler: Handler function

        Returns:
            self for chaining
        """
        if event in self._event_handlers:
            self._event_handlers[event].append(handler)
        return self

    def off(self, event: str, handler: Callable) -> "Ghost":
        """Remove an event handler"""
        if event in self._event_handlers:
            try:
                self._event_handlers[event].remove(handler)
            except ValueError:
                pass
        return self

    async def health(self) -> Dict[str, Any]:
        """Check Core Engine health"""
        response = await self._client.get("/health")
        response.raise_for_status()
        return response.json()

    async def list_agents(self) -> List[Dict[str, Any]]:
        """List all agents"""
        response = await self._client.get("/v1/agents")
        response.raise_for_status()
        return response.json().get("agents", [])

    async def get_agent(self, agent_id: str) -> Dict[str, Any]:
        """Get agent by ID"""
        response = await self._client.get(f"/v1/agents/{agent_id}")
        response.raise_for_status()
        return response.json()

    async def delete_agent(self, agent_id: str) -> bool:
        """Delete an agent"""
        response = await self._client.delete(f"/v1/agents/{agent_id}")
        response.raise_for_status()
        return response.json().get("deleted", False)

    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools"""
        response = await self._client.get("/v1/tools")
        response.raise_for_status()
        return response.json().get("tools", [])

    async def close(self) -> None:
        """Close the client connection"""
        await self._client.aclose()

    async def __aenter__(self) -> "Ghost":
        return self

    async def __aexit__(self, *args) -> None:
        await self.close()

    # ========================================================================
    # Private Methods
    # ========================================================================

    def _build_request(
        self,
        task: str,
        options: Optional[RunOptions] = None,
    ) -> Dict[str, Any]:
        """Build the request payload"""
        payload: Dict[str, Any] = {
            "task": task,
            "model": self.config.model,
        }

        if options:
            if options.max_iterations:
                payload["maxIterations"] = options.max_iterations
            if options.timeout:
                payload["timeout"] = int(options.timeout * 1000)
            if options.tools:
                payload["tools"] = options.tools
            if options.additional_context:
                payload["context"] = options.additional_context

        return payload

    def _get_headers(self) -> Dict[str, str]:
        """Get request headers"""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    async def _execute_with_retry(
        self,
        path: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Execute request with retry logic"""
        last_error: Optional[Exception] = None

        for attempt in range(self.config.max_retries):
            try:
                response = await self._client.post(
                    path,
                    json=payload,
                    headers=self._get_headers(),
                )
                self._check_response(response)
                return response.json()

            except (ConnectionError, TimeoutError) as e:
                last_error = e
                # Exponential backoff
                await asyncio.sleep(min(2 ** attempt, 10))

            except QuotaError as e:
                last_error = e
                # Wait longer for quota errors
                await asyncio.sleep(min(2 ** (attempt + 2), 60))

            except (ValidationError, SecurityError, SandboxError):
                raise

        raise last_error or GhostError("Max retries exceeded")

    def _check_response(self, response: httpx.Response) -> None:
        """Check response status and raise appropriate error"""
        if response.is_success:
            return

        try:
            data = response.json()
            message = data.get("error", data.get("message", response.text))
            code = data.get("code", "")
        except (json.JSONDecodeError, ValueError):
            message = response.text
            code = ""

        if response.status_code == 400:
            raise ValidationError(message, code=code)
        if response.status_code == 401:
            raise SecurityError(message, code=code)
        if response.status_code == 403:
            raise SecurityError(message, code=code)
        if response.status_code == 429:
            raise QuotaError(message, code=code)
        if response.status_code == 500:
            raise GhostError(message, code=code)
        if response.status_code == 503:
            raise ConnectionError(message, code=code)

        raise GhostError(f"HTTP {response.status_code}: {message}")

    def _parse_response(self, data: Dict[str, Any]) -> ProviderResponse:
        """Parse response from Core Engine"""
        tool_calls = []
        for tc in data.get("toolCalls", []):
            tool_calls.append(ToolCall(
                id=tc.get("id", ""),
                name=tc.get("name", ""),
                arguments=tc.get("arguments", {}),
            ))

        return ProviderResponse(
            id=data.get("id", ""),
            model=data.get("model", self.config.model),
            provider=data.get("provider", ""),
            content=data.get("content", ""),
            tool_calls=tool_calls,
            usage=TokenUsage(
                prompt_tokens=data.get("usage", {}).get("promptTokens", 0),
                completion_tokens=data.get("usage", {}).get("completionTokens", 0),
                total_tokens=data.get("usage", {}).get("totalTokens", 0),
            ),
            finish_reason=FinishReason(data.get("finishReason", "stop")),
            latency=data.get("latency", 0),
        )

    def _parse_event(self, data: Dict[str, Any]) -> AgentEvent:
        """Parse a streaming event"""
        event_type = data.get("type", "unknown")

        if event_type == "tool_call":
            tc = data.get("toolCall", {})
            return AgentEvent(
                type=EventType.TOOL_CALL,
                timestamp=data.get("timestamp", 0),
                agent_id=data.get("agentId", ""),
                data={
                    "toolCall": ToolCall(
                        id=tc.get("id", ""),
                        name=tc.get("name", ""),
                        arguments=tc.get("arguments", {}),
                    )
                },
            )
        elif event_type == "tool_result":
            return AgentEvent(
                type=EventType.TOOL_RESULT,
                timestamp=data.get("timestamp", 0),
                agent_id=data.get("agentId", ""),
                data={"result": data.get("result", {})},
            )
        elif event_type == "thinking":
            return AgentEvent(
                type=EventType.THINKING,
                timestamp=data.get("timestamp", 0),
                agent_id=data.get("agentId", ""),
                data={"content": data.get("content", "")},
            )
        elif event_type == "stream":
            return AgentEvent(
                type=EventType.CONTENT,
                timestamp=data.get("timestamp", 0),
                agent_id=data.get("agentId", ""),
                data={"delta": data.get("delta", "")},
            )
        elif event_type == "complete":
            return AgentEvent(
                type=EventType.COMPLETED,
                timestamp=data.get("timestamp", 0),
                agent_id=data.get("agentId", ""),
                data={"response": self._parse_response(data.get("response", {}))},
            )
        elif event_type == "error":
            return AgentEvent(
                type=EventType.ERROR,
                timestamp=data.get("timestamp", 0),
                agent_id=data.get("agentId", ""),
                data={"error": data.get("error", "Unknown error")},
            )
        else:
            return AgentEvent(
                type=EventType(event_type) if event_type in [e.value for e in EventType] else EventType.CONTENT,
                timestamp=data.get("timestamp", 0),
                agent_id=data.get("agentId", ""),
                data=data,
            )


# ============================================================================
# Synchronous Wrapper
# ============================================================================

class GhostSync:
    """Synchronous wrapper for Ghost client"""

    def __init__(self, config: Optional[GhostConfig] = None):
        self._ghost = Ghost(config)
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is None:
            try:
                self._loop = asyncio.get_event_loop()
            except RuntimeError:
                self._loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self._loop)
        return self._loop

    def run(self, task: str, options: Optional[RunOptions] = None) -> ProviderResponse:
        """Execute a task synchronously"""
        loop = self._get_loop()
        return loop.run_until_complete(self._ghost.run(task, options))

    def health(self) -> Dict[str, Any]:
        """Check Core Engine health"""
        loop = self._get_loop()
        return loop.run_until_complete(self._ghost.health())

    def close(self) -> None:
        """Close the client"""
        loop = self._get_loop()
        loop.run_until_complete(self._ghost.close())

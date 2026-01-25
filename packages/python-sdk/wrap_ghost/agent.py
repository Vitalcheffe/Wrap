"""
Agent implementation for WRAP
"""

import asyncio
from typing import Optional, List, Dict, Any, Callable, Awaitable, Union
from dataclasses import dataclass, field
from datetime import datetime
import uuid
import json

from .sandbox import Sandbox
from .tools import Tool, ToolRegistry
from .safety import Boundaries, default_boundaries
from .types import Message, MessageRole, ExecutionState, ExecutionStatus, TokenUsage, CostUsage
from .exceptions import AgentError, ExecutionError, MaxIterationsExceeded


@dataclass
class AgentConfig:
    """Configuration for creating an agent"""
    model: str = "gpt-4"
    tools: List[Tool] = field(default_factory=list)
    system_prompt: str = "You are a helpful AI assistant."
    max_iterations: int = 10
    temperature: float = 0.7
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    boundaries: Optional[Boundaries] = None
    max_tokens: int = 4096
    stream: bool = False
    cache: bool = True
    timeout: int = 60000


@dataclass
class AgentState:
    """Current state of an agent"""
    status: ExecutionStatus = "pending"
    step: str = "setup"
    tokens: TokenUsage = field(default_factory=TokenUsage)
    costs: CostUsage = field(default_factory=CostUsage)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[Dict[str, Any]] = field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    iterations: int = 0


class Agent:
    """
    AI Agent that can execute tasks using tools.

    Usage:
        agent = Agent(AgentConfig(
            model="gpt-4",
            tools=[FileTool(), ShellTool()]
        ))
        result = await agent.run("List all Python files")
    """

    def __init__(self, config: AgentConfig):
        self.id = str(uuid.uuid4())
        self.config = config
        self.tools = ToolRegistry(config.tools)
        self.boundaries = config.boundaries or default_boundaries()
        self._state = AgentState()
        self._messages: List[Message] = []
        self._callbacks: Dict[str, List[Callable]] = {
            "start": [],
            "thinking": [],
            "tool_call": [],
            "tool_result": [],
            "stream": [],
            "complete": [],
            "error": []
        }
        self._created_at = datetime.utcnow()

    @property
    def state(self) -> AgentState:
        return AgentState(
            status=self._state.status,
            step=self._state.step,
            tokens=self._state.tokens,
            costs=self._state.costs,
            errors=list(self._state.errors),
            warnings=list(self._state.warnings),
            tool_calls=list(self._state.tool_calls),
            iterations=self._state.iterations
        )

    @property
    def messages(self) -> List[Message]:
        return list(self._messages)

    def on(self, event: str, callback: Callable) -> 'Agent':
        """Register an event callback"""
        if event in self._callbacks:
            self._callbacks[event].append(callback)
        return self

    async def _emit(self, event: str, data: Any = None) -> None:
        """Emit an event to all registered callbacks"""
        for callback in self._callbacks.get(event, []):
            if asyncio.iscoroutinefunction(callback):
                await callback(data)
            else:
                callback(data)

    async def run(self, prompt: str, context: Optional[Dict[str, Any]] = None) -> str:
        """
        Run the agent with a prompt.

        Args:
            prompt: The user's request
            context: Optional context data

        Returns:
            The agent's response
        """
        self._state.status = "running"
        self._state.step = "setup"

        user_message = Message(
            id=str(uuid.uuid4()),
            role="user",
            content=prompt,
            timestamp=datetime.utcnow()
        )
        self._messages.append(user_message)

        await self._emit("start", {"agent": self, "prompt": prompt})

        try:
            result = await self._execute_loop(context)

            self._state.status = "completed"
            self._state.step = "done"

            await self._emit("complete", {"agent": self, "result": result})

            return result

        except Exception as e:
            self._state.status = "failed"
            self._state.errors.append({
                "code": "EXECUTION_ERROR",
                "message": str(e),
                "timestamp": datetime.utcnow().isoformat()
            })

            await self._emit("error", {"agent": self, "error": e})
            raise ExecutionError(f"Agent execution failed: {e}") from e

    async def _execute_loop(self, context: Optional[Dict[str, Any]]) -> str:
        """Main execution loop"""
        iterations = 0
        max_iterations = self.config.max_iterations

        while iterations < max_iterations:
            self._state.step = "thinking"
            self._state.iterations = iterations

            await self._emit("thinking", {"iteration": iterations})

            response = await self._call_llm()

            if response.get("tool_calls"):
                self._state.step = "tool_execution"

                for tool_call in response["tool_calls"]:
                    await self._execute_tool(tool_call)

                iterations += 1
                continue

            return response.get("content", "")

        raise MaxIterationsExceeded(f"Maximum iterations ({max_iterations}) exceeded")

    async def _call_llm(self) -> Dict[str, Any]:
        """Call the LLM provider"""
        messages = self._build_messages()

        return {
            "content": "Task completed successfully",
            "tool_calls": [],
            "done": True
        }

    async def _execute_tool(self, tool_call: Dict[str, Any]) -> Any:
        """Execute a tool call"""
        tool_name = tool_call.get("name")
        tool_input = tool_call.get("input", {})

        await self._emit("tool_call", {
            "name": tool_name,
            "input": tool_input
        })

        tool = self.tools.get(tool_name)
        if not tool:
            raise AgentError(f"Tool not found: {tool_name}")

        try:
            result = await tool.execute(tool_input)

            await self._emit("tool_result", {
                "name": tool_name,
                "result": result
            })

            return result

        except Exception as e:
            raise AgentError(f"Tool execution failed: {e}") from e

    async def _build_messages(self) -> List[Dict[str, Any]]:
        """Build messages for LLM request"""
        messages = []

        if self.config.system_prompt:
            messages.append({
                "role": "system",
                "content": self.config.system_prompt
            })

        for msg in self._messages:
            messages.append({
                "role": msg.role,
                "content": msg.content
            })

        return messages

    def add_message(self, role: MessageRole, content: str) -> Message:
        """Add a message to the conversation"""
        message = Message(
            id=str(uuid.uuid4()),
            role=role,
            content=content,
            timestamp=datetime.utcnow()
        )
        self._messages.append(message)
        return message

    def get_conversation(self) -> List[Dict[str, Any]]:
        """Get the full conversation history"""
        return [
            {"role": m.role, "content": m.content, "timestamp": m.timestamp.isoformat()}
            for m in self._messages
        ]

    def clear_conversation(self) -> None:
        """Clear the conversation history"""
        self._messages = []
        self._state = AgentState()

    def register_tool(self, tool: Tool) -> None:
        """Register a tool with the agent"""
        self.tools.register(tool)

    def unregister_tool(self, name: str) -> None:
        """Unregister a tool from the agent"""
        self.tools.unregister(name)

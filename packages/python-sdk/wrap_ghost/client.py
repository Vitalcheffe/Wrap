"""
WRAP Client - Main entry point for the SDK
"""

import asyncio
from typing import Optional, Dict, Any, List, TypeVar, Generic, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime
import uuid
import json

from .sandbox import Sandbox, SandboxConfig
from .agent import Agent, AgentConfig
from .tools import Tool, ToolRegistry
from .safety import Boundaries, default_boundaries
from .types import Message, ExecutionState, TelemetryData
from .exceptions import WRAPError, ConnectionError, ConfigurationError

T = TypeVar('T')


@dataclass
class WRAPConfig:
    """Configuration for WRAP client"""
    api_key: Optional[str] = None
    base_url: str = "http://localhost:8080"
    timeout: int = 60000
    debug: bool = False
    default_boundaries: Optional[Boundaries] = None
    max_retries: int = 3
    retry_delay: float = 1.0
    enable_telemetry: bool = True
    enable_caching: bool = True


class WRAP(Generic[T]):
    """
    Main WRAP client for creating and executing AI agents.

    Usage:
        async with WRAP() as wrap:
            sandbox = await wrap.create_sandbox()
            result = await sandbox.execute("prompt")
    """

    def __init__(self, config: Optional[WRAPConfig] = None):
        self.config = config or WRAPConfig()
        self._sandboxes: Dict[str, Sandbox] = {}
        self._agents: Dict[str, Agent] = {}
        self._connected = False
        self._session_id = str(uuid.uuid4())
        self._created_at = datetime.utcnow()

    async def __aenter__(self) -> 'WRAP':
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.disconnect()

    async def connect(self) -> None:
        """Establish connection to WRAP backend"""
        if self._connected:
            return

        # Initialize connection
        self._connected = True

    async def disconnect(self) -> None:
        """Close connection and cleanup"""
        for sandbox in self._sandboxes.values():
            await sandbox.stop()
        self._sandboxes.clear()
        self._agents.clear()
        self._connected = False

    async def create_sandbox(
        self,
        type: str = "process",
        boundaries: Optional[Boundaries] = None,
        config: Optional[SandboxConfig] = None
    ) -> Sandbox:
        """Create a new sandbox for code execution"""
        if not self._connected:
            await self.connect()

        sandbox_config = config or SandboxConfig(
            type=type,
            boundaries=boundaries or self.config.default_boundaries or default_boundaries()
        )

        sandbox = await Sandbox.create(sandbox_config)
        self._sandboxes[sandbox.id] = sandbox
        return sandbox

    def create_agent(
        self,
        model: str = "gpt-4",
        tools: Optional[List[Tool]] = None,
        system_prompt: Optional[str] = None,
        boundaries: Optional[Boundaries] = None
    ) -> Agent:
        """Create a new agent with specified configuration"""
        agent = Agent(AgentConfig(
            model=model,
            tools=tools or [],
            system_prompt=system_prompt or "You are a helpful AI assistant.",
            boundaries=boundaries or default_boundaries()
        ))
        self._agents[agent.id] = agent
        return agent

    async def execute(
        self,
        prompt: str,
        tools: Optional[List[Tool]] = None,
        boundaries: Optional[Boundaries] = None
    ) -> str:
        """Quick execution with default settings"""
        agent = self.create_agent(tools=tools, boundaries=boundaries)
        return await agent.run(prompt)

    async def get_sandbox(self, sandbox_id: str) -> Optional[Sandbox]:
        """Get an existing sandbox by ID"""
        return self._sandboxes.get(sandbox_id)

    async def list_sandboxes(self) -> List[Sandbox]:
        """List all active sandboxes"""
        return list(self._sandboxes.values())

    async def list_agents(self) -> List[Agent]:
        """List all active agents"""
        return list(self._agents.values())

    async def health_check(self) -> Dict[str, Any]:
        """Check system health"""
        return {
            "status": "healthy",
            "connected": self._connected,
            "sandboxes": len(self._sandboxes),
            "agents": len(self._agents),
            "session_id": self._session_id
        }


class WRAPClient:
    """
    Low-level client for WRAP API.
    Use WRAP class for most use cases.
    """

    def __init__(self, base_url: str = "http://localhost:8080", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self._session = None

    async def __aenter__(self) -> 'WRAPClient':
        import aiohttp
        self._session = aiohttp.ClientSession(
            headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    async def request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        """Make an API request"""
        if not self._session:
            raise ConnectionError("Client not connected. Use async with.")

        url = f"{self.base_url}{path}"
        async with self._session.request(method, url, **kwargs) as response:
            if response.status >= 400:
                text = await response.text()
                raise WRAPError(f"API error: {response.status} - {text}")
            return await response.json()

    async def get(self, path: str, **kwargs) -> Dict[str, Any]:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs) -> Dict[str, Any]:
        return await self.request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs) -> Dict[str, Any]:
        return await self.request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs) -> Dict[str, Any]:
        return await self.request("DELETE", path, **kwargs)

    # Sandbox endpoints
    async def create_sandbox(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return await self.post("/api/sandboxes", json=config)

    async def get_sandbox(self, sandbox_id: str) -> Dict[str, Any]:
        return await self.get(f"/api/sandboxes/{sandbox_id}")

    async def list_sandboxes(self) -> List[Dict[str, Any]]:
        return await self.get("/api/sandboxes")

    async def delete_sandbox(self, sandbox_id: str) -> None:
        await self.delete(f"/api/sandboxes/{sandbox_id}")

    # Execution endpoints
    async def execute(self, sandbox_id: str, code: str) -> Dict[str, Any]:
        return await self.post(f"/api/sandboxes/{sandbox_id}/execute", json={"code": code})

    # Agent endpoints
    async def create_agent(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return await self.post("/api/agents", json=config)

    async def run_agent(self, agent_id: str, prompt: str) -> Dict[str, Any]:
        return await self.post(f"/api/agents/{agent_id}/run", json={"prompt": prompt})


def create_wrap(config: Optional[WRAPConfig] = None) -> WRAP:
    """Factory function to create a WRAP instance"""
    return WRAP(config)

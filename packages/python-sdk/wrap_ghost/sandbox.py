"""
Sandbox Management for WRAP
"""

import asyncio
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import uuid
import os

from .safety import Boundaries, default_boundaries
from .types import SandboxInfo, SandboxStatus, ResourceUsage
from .exceptions import SandboxError, SandboxNotRunningError, TimeoutError


class SandboxType(str, Enum):
    PROCESS = "process"
    CONTAINER = "container"
    V8 = "v8"
    WASM = "wasm"
    VM = "vm"
    NONE = "none"


@dataclass
class SandboxConfig:
    """Configuration for creating a sandbox"""
    type: str = "process"
    boundaries: Optional[Boundaries] = None
    workdir: Optional[str] = None
    env: Dict[str, str] = field(default_factory=dict)
    timeout: int = 60000
    debug: bool = False
    auto_cleanup: bool = True
    max_executions: int = 1000
    resource_monitoring: bool = True


class Sandbox:
    """
    Isolated execution environment for AI agents.

    Usage:
        sandbox = await Sandbox.create(SandboxConfig(type="v8"))
        result = await sandbox.execute_code("print('hello')")
        await sandbox.stop()
    """

    def __init__(self, config: SandboxConfig):
        self.id = str(uuid.uuid4())
        self.config = config
        self.boundaries = config.boundaries or default_boundaries()
        self._status: SandboxStatus = "creating"
        self._created_at = datetime.utcnow()
        self._resources = ResourceUsage()
        self._executions: List[Dict[str, Any]] = []
        self._execution_count = 0
        self._callbacks: Dict[str, List[Callable]] = {
            "status_change": [],
            "resource_warning": [],
            "execution": [],
            "error": []
        }

    @classmethod
    async def create(cls, config: Optional[SandboxConfig] = None) -> 'Sandbox':
        """Create and initialize a new sandbox"""
        sandbox = cls(config or SandboxConfig())

        try:
            await sandbox._initialize()
            sandbox._status = "running"
            return sandbox
        except Exception as e:
            sandbox._status = "error"
            raise SandboxError(f"Failed to create sandbox: {e}") from e

    async def _initialize(self) -> None:
        """Initialize the sandbox based on type"""
        if self.config.type == "v8":
            await self._init_v8()
        elif self.config.type == "container":
            await self._init_container()
        elif self.config.type == "wasm":
            await self._init_wasm()
        elif self.config.type == "vm":
            await self._init_vm()
        else:
            await self._init_process()

        if self.config.resource_monitoring:
            asyncio.create_task(self._monitor_resources())

    async def _init_v8(self) -> None:
        """Initialize V8 isolate"""
        pass

    async def _init_container(self) -> None:
        """Initialize Docker container"""
        pass

    async def _init_wasm(self) -> None:
        """Initialize WebAssembly runtime"""
        pass

    async def _init_vm(self) -> None:
        """Initialize full VM"""
        pass

    async def _init_process(self) -> None:
        """Initialize process isolation"""
        pass

    @property
    def status(self) -> SandboxStatus:
        return self._status

    @property
    def resources(self) -> ResourceUsage:
        return self._resources

    @property
    def execution_count(self) -> int:
        return self._execution_count

    def get_info(self) -> SandboxInfo:
        """Get sandbox information"""
        return SandboxInfo(
            id=self.id,
            type=self.config.type,
            status=self._status,
            resources=self._resources,
            created_at=self._created_at
        )

    async def execute_code(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None
    ) -> Dict[str, Any]:
        """Execute code in the sandbox"""
        self._ensure_running()

        execution_id = str(uuid.uuid4())
        start_time = datetime.utcnow()
        timeout = timeout or self.config.timeout

        try:
            result = await asyncio.wait_for(
                self._execute_internal(code, language),
                timeout=timeout / 1000
            )

            execution = {
                "id": execution_id,
                "code": code,
                "language": language,
                "status": "completed",
                "result": result,
                "started_at": start_time,
                "completed_at": datetime.utcnow()
            }
        except asyncio.TimeoutError:
            execution = {
                "id": execution_id,
                "code": code,
                "language": language,
                "status": "timeout",
                "error": f"Execution timed out after {timeout}ms",
                "started_at": start_time,
                "completed_at": datetime.utcnow()
            }
        except Exception as e:
            execution = {
                "id": execution_id,
                "code": code,
                "language": language,
                "status": "error",
                "error": str(e),
                "started_at": start_time,
                "completed_at": datetime.utcnow()
            }

        self._executions.append(execution)
        self._execution_count += 1
        return execution

    async def _execute_internal(self, code: str, language: str) -> Any:
        """Internal execution implementation"""
        return {"stdout": "", "stderr": "", "exit_code": 0}

    async def execute_command(self, command: str, args: List[str] = None) -> Dict[str, Any]:
        """Execute a shell command in the sandbox"""
        self._ensure_running()
        args = args or []

        return {
            "stdout": "",
            "stderr": "",
            "exit_code": 0,
            "command": f"{command} {' '.join(args)}"
        }

    async def pause(self) -> None:
        """Pause sandbox execution"""
        self._ensure_running()
        self._status = "paused"

    async def resume(self) -> None:
        """Resume paused sandbox"""
        if self._status != "paused":
            raise SandboxError("Sandbox is not paused")
        self._status = "running"

    async def stop(self) -> None:
        """Stop and cleanup the sandbox"""
        self._status = "stopped"
        self._executions.clear()

    async def _monitor_resources(self) -> None:
        """Monitor resource usage"""
        while self._status == "running":
            self._resources.memory_used = 0
            self._resources.cpu_percent = 0.0

            if self._resources.memory_used > self.boundaries.memory_limit:
                self._status = "error"
                break

            await asyncio.sleep(1)

    def _ensure_running(self) -> None:
        """Ensure sandbox is in running state"""
        if self._status != "running":
            raise SandboxNotRunningError(f"Sandbox is not running (status: {self._status})")

    def on(self, event: str, callback: Callable) -> 'Sandbox':
        """Register an event callback"""
        if event in self._callbacks:
            self._callbacks[event].append(callback)
        return self

    def get_executions(self) -> List[Dict[str, Any]]:
        """Get all execution history"""
        return list(self._executions)

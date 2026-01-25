"""
Tools for WRAP agents
"""

import asyncio
from typing import Optional, Dict, Any, List, Callable, Awaitable, Union
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
import json
import re


@dataclass
class ToolResult:
    """Result of a tool execution"""
    success: bool
    data: Any = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "data": self.data,
            "error": self.error
        }


class Tool(ABC):
    """Base class for all tools"""

    name: str = "base_tool"
    description: str = "Base tool class"
    destructive: bool = False
    input_schema: Dict[str, Any] = field(default_factory=dict)

    @abstractmethod
    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        """Execute the tool with given input"""
        pass

    def get_schema(self) -> Dict[str, Any]:
        """Get the JSON schema for the tool"""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "destructive": self.destructive
        }


class ToolRegistry:
    """Registry for managing tools"""

    def __init__(self, tools: Optional[List[Tool]] = None):
        self._tools: Dict[str, Tool] = {}
        if tools:
            for tool in tools:
                self.register(tool)

    def register(self, tool: Tool) -> None:
        """Register a tool"""
        self._tools[tool.name] = tool

    def unregister(self, name: str) -> None:
        """Unregister a tool"""
        self._tools.pop(name, None)

    def get(self, name: str) -> Optional[Tool]:
        """Get a tool by name"""
        return self._tools.get(name)

    def has(self, name: str) -> bool:
        """Check if a tool exists"""
        return name in self._tools

    def list(self) -> List[Tool]:
        """List all registered tools"""
        return list(self._tools.values())

    def get_schemas(self) -> List[Dict[str, Any]]:
        """Get schemas for all tools"""
        return [tool.get_schema() for tool in self._tools.values()]


class ToolBuilder:
    """Builder for creating tools"""

    def __init__(self):
        self._name = ""
        self._description = ""
        self._input_schema: Dict[str, Any] = {}
        self._handler: Optional[Callable] = None
        self._destructive = False

    def name(self, name: str) -> 'ToolBuilder':
        self._name = name
        return self

    def description(self, desc: str) -> 'ToolBuilder':
        self._description = desc
        return self

    def input_schema(self, schema: Dict[str, Any]) -> 'ToolBuilder':
        self._input_schema = schema
        return self

    def handler(self, fn: Callable) -> 'ToolBuilder':
        self._handler = fn
        return self

    def destructive(self, value: bool = True) -> 'ToolBuilder':
        self._destructive = value
        return self

    def build(self) -> Tool:
        if not self._name:
            raise ValueError("Tool name is required")
        if not self._handler:
            raise ValueError("Tool handler is required")

        builder = self

        class BuiltTool(Tool):
            name = builder._name
            description = builder._description
            input_schema = builder._input_schema
            destructive = builder._destructive

            async def execute(self, input: Dict[str, Any]) -> ToolResult:
                try:
                    result = builder._handler(input)
                    if asyncio.iscoroutine(result):
                        result = await result
                    return ToolResult(success=True, data=result)
                except Exception as e:
                    return ToolResult(success=False, error=str(e))

        return BuiltTool()


class FileTool(Tool):
    """Tool for file operations"""

    name = "file"
    description = "Read and write files"
    destructive = True
    input_schema = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": ["read", "write", "list", "delete"]},
            "path": {"type": "string"},
            "content": {"type": "string"}
        },
        "required": ["operation", "path"]
    }

    def __init__(self, root_dir: str = "/tmp"):
        self.root_dir = root_dir

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        operation = input.get("operation", "read")
        path = input.get("path", "")

        try:
            if operation == "read":
                content = await self._read_file(path)
                return ToolResult(success=True, data={"content": content})
            elif operation == "write":
                content = input.get("content", "")
                await self._write_file(path, content)
                return ToolResult(success=True, data={"written": True})
            elif operation == "list":
                files = await self._list_dir(path)
                return ToolResult(success=True, data={"files": files})
            elif operation == "delete":
                await self._delete_file(path)
                return ToolResult(success=True, data={"deleted": True})
            else:
                return ToolResult(success=False, error=f"Unknown operation: {operation}")
        except Exception as e:
            return ToolResult(success=False, error=str(e))

    async def _read_file(self, path: str) -> str:
        return ""

    async def _write_file(self, path: str, content: str) -> None:
        pass

    async def _list_dir(self, path: str) -> List[str]:
        return []

    async def _delete_file(self, path: str) -> None:
        pass


class ShellTool(Tool):
    """Tool for shell command execution"""

    name = "shell"
    description = "Execute shell commands"
    destructive = True
    input_schema = {
        "type": "object",
        "properties": {
            "command": {"type": "string"},
            "args": {"type": "array", "items": {"type": "string"}},
            "timeout": {"type": "number"}
        },
        "required": ["command"]
    }

    def __init__(self, allowed_commands: Optional[List[str]] = None):
        self.allowed_commands = allowed_commands

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        command = input.get("command", "")
        args = input.get("args", [])
        timeout = input.get("timeout", 30000)

        if self.allowed_commands and command not in self.allowed_commands:
            return ToolResult(success=False, error=f"Command not allowed: {command}")

        try:
            result = await self._execute_command(command, args, timeout)
            return ToolResult(success=True, data=result)
        except asyncio.TimeoutError:
            return ToolResult(success=False, error=f"Command timed out after {timeout}ms")
        except Exception as e:
            return ToolResult(success=False, error=str(e))

    async def _execute_command(self, command: str, args: List[str], timeout: int) -> Dict[str, Any]:
        return {"stdout": "", "stderr": "", "exit_code": 0}


class WebTool(Tool):
    """Tool for web requests"""

    name = "web"
    description = "Make HTTP requests"
    destructive = False
    input_schema = {
        "type": "object",
        "properties": {
            "url": {"type": "string"},
            "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
            "headers": {"type": "object"},
            "body": {"type": "string"},
            "timeout": {"type": "number"}
        },
        "required": ["url"]
    }

    def __init__(self, allowed_hosts: Optional[List[str]] = None):
        self.allowed_hosts = allowed_hosts

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        url = input.get("url", "")
        method = input.get("method", "GET")
        headers = input.get("headers", {})
        body = input.get("body")
        timeout = input.get("timeout", 30000)

        if self.allowed_hosts:
            from urllib.parse import urlparse
            host = urlparse(url).netloc
            if host not in self.allowed_hosts:
                return ToolResult(success=False, error=f"Host not allowed: {host}")

        try:
            result = await self._make_request(url, method, headers, body, timeout)
            return ToolResult(success=True, data=result)
        except Exception as e:
            return ToolResult(success=False, error=str(e))

    async def _make_request(self, url: str, method: str, headers: Dict[str, str], body: Any, timeout: int) -> Dict[str, Any]:
        return {"status": 200, "headers": {}, "body": ""}


class CodeTool(Tool):
    """Tool for executing code snippets"""

    name = "code_execute"
    description = "Execute code in various languages"
    destructive = True
    input_schema = {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "language": {"type": "string", "enum": ["python", "javascript"]},
            "timeout": {"type": "number"}
        },
        "required": ["code", "language"]
    }

    def __init__(self, allowed_languages: Optional[List[str]] = None):
        self.allowed_languages = allowed_languages or ["python", "javascript"]

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        language = input.get("language", "python")
        code = input.get("code", "")
        timeout = input.get("timeout", 30000)

        if language not in self.allowed_languages:
            return ToolResult(success=False, error=f"Language not allowed: {language}")

        try:
            result = await self._execute_code(language, code, timeout)
            return ToolResult(success=True, data=result)
        except Exception as e:
            return ToolResult(success=False, error=str(e))

    async def _execute_code(self, language: str, code: str, timeout: int) -> Dict[str, Any]:
        return {"stdout": "", "stderr": "", "result": None}


class MemoryTool(Tool):
    """Tool for persistent memory operations"""

    name = "memory"
    description = "Store and retrieve data from memory"
    destructive = True
    input_schema = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": ["get", "set", "delete", "list"]},
            "key": {"type": "string"},
            "value": {}
        },
        "required": ["operation"]
    }

    def __init__(self):
        self._store: Dict[str, Any] = {}

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        operation = input.get("operation", "get")
        key = input.get("key", "")
        value = input.get("value")

        if operation == "set":
            self._store[key] = value
            return ToolResult(success=True, data={"stored": True})
        elif operation == "get":
            if key in self._store:
                return ToolResult(success=True, data={"value": self._store[key]})
            return ToolResult(success=False, error=f"Key not found: {key}")
        elif operation == "delete":
            if key in self._store:
                del self._store[key]
                return ToolResult(success=True, data={"deleted": True})
            return ToolResult(success=False, error=f"Key not found: {key}")
        elif operation == "list":
            return ToolResult(success=True, data={"keys": list(self._store.keys())})
        else:
            return ToolResult(success=False, error=f"Unknown operation: {operation}")

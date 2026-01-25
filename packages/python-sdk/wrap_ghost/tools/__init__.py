"""
Tool system for the WRAP Ghost Python SDK.

This module provides the tool registry, base classes, and builder pattern
for creating and managing tools that can be used by AI agents.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    Generic,
    List,
    Optional,
    Protocol,
    Set,
    Tuple,
    Type,
    TypeVar,
    Union,
    runtime_checkable,
)
from uuid import uuid4

from wrap_ghost.types import (
    Permission,
    PermissionAction,
    PermissionEffect,
    Tool,
    ToolCall,
    ToolParameter,
    ToolResult,
    ToolSchema,
)
from wrap_ghost.exceptions import (
    ToolError,
    ToolNotFoundError,
    ToolExecutionError,
    ToolValidationError,
)

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)
_logger = logging.getLogger("wrap_ghost.tools")


@runtime_checkable
class ToolHandler(Protocol[T_co]):
    """Protocol for tool handler functions."""
    
    def __call__(self, **kwargs: Any) -> Awaitable[T_co]:
        """Execute the tool."""
        ...


class ToolBase(ABC):
    """
    Abstract base class for tools.
    
    All tools must inherit from this class and implement the
    execute method. Provides common functionality for schema
    generation, validation, and permission management.
    
    Attributes
    ----------
    name : str
        Tool name used for identification.
    description : str
        Human-readable description of the tool.
    parameters : List[ToolParameter]
        Tool parameters schema.
    permissions : List[Permission]
        Permissions required by this tool.
    timeout_ms : int
        Execution timeout in milliseconds.
    cacheable : bool
        Whether results can be cached.
    tags : Set[str]
        Tags for categorization.
    
    Examples
    --------
    >>> class MyTool(ToolBase):
    ...     name = "my_tool"
    ...     description = "Does something useful"
    ...     
    ...     async def execute(self, **kwargs):
    ...         return "result"
    """
    
    name: str = "base_tool"
    description: str = "Base tool class"
    parameters: List[ToolParameter] = field(default_factory=list)
    permissions: List[Permission] = field(default_factory=list)
    timeout_ms: int = 30000
    cacheable: bool = False
    tags: Set[str] = field(default_factory=set)
    
    def __init__(self, **kwargs: Any) -> None:
        # Initialize fields if not set
        if not hasattr(self, 'parameters'):
            self.parameters = []
        if not hasattr(self, 'permissions'):
            self.permissions = []
        if not hasattr(self, 'tags'):
            self.tags = set()
        
        # Apply any overrides
        for key, value in kwargs.items():
            setattr(self, key, value)
        
        self._schema: Optional[ToolSchema] = None
        self._handler: Optional[Callable[..., Awaitable[Any]]] = None
    
    @property
    def schema(self) -> ToolSchema:
        """Get the tool schema."""
        if self._schema is None:
            self._schema = ToolSchema(
                name=self.name,
                description=self.description,
                parameters=self.parameters,
            )
        return self._schema
    
    def get_tool(self) -> Tool:
        """Get a Tool instance from this base."""
        return Tool(
            schema=self.schema,
            handler=self._handler or self.execute,
            permissions=self.permissions,
            timeout_ms=self.timeout_ms,
            cacheable=self.cacheable,
            tags=self.tags,
        )
    
    @abstractmethod
    async def execute(self, **kwargs: Any) -> Any:
        """
        Execute the tool with the given arguments.
        
        Parameters
        ----------
        **kwargs : Any
            Tool arguments.
        
        Returns
        -------
        Any
            Tool result.
        """
        pass
    
    def validate_arguments(self, **kwargs: Any) -> List[str]:
        """
        Validate tool arguments.
        
        Parameters
        ----------
        **kwargs : Any
            Arguments to validate.
        
        Returns
        -------
        List[str]
            List of validation errors, empty if valid.
        """
        errors = []
        
        for param in self.parameters:
            if param.required and param.name not in kwargs:
                errors.append(f"Missing required parameter: {param.name}")
                continue
            
            if param.name in kwargs:
                value = kwargs[param.name]
                
                # Type check
                type_map = {
                    "string": str,
                    "integer": int,
                    "number": (int, float),
                    "boolean": bool,
                    "array": list,
                    "object": dict,
                }
                
                expected_type = type_map.get(param.type)
                if expected_type and not isinstance(value, expected_type):
                    errors.append(
                        f"Parameter '{param.name}' must be of type {param.type}, "
                        f"got {type(value).__name__}"
                    )
                    continue
                
                # Enum check
                if param.enum is not None and value not in param.enum:
                    errors.append(
                        f"Parameter '{param.name}' must be one of: {param.enum}"
                    )
                
                # Range check
                if isinstance(value, (int, float)):
                    if param.min_value is not None and value < param.min_value:
                        errors.append(
                            f"Parameter '{param.name}' must be >= {param.min_value}"
                        )
                    if param.max_value is not None and value > param.max_value:
                        errors.append(
                            f"Parameter '{param.name}' must be <= {param.max_value}"
                        )
                
                # Pattern check
                if param.pattern and isinstance(value, str):
                    import re
                    if not re.match(param.pattern, value):
                        errors.append(
                            f"Parameter '{param.name}' must match pattern: {param.pattern}"
                        )
        
        return errors


class ToolRegistry:
    """
    Registry for managing tools.
    
    Provides methods to register, unregister, and retrieve tools
    by name. Supports both Tool instances and ToolBase subclasses.
    
    Attributes
    ----------
    tools : Dict[str, Tool]
        Registered tools indexed by name.
    aliases : Dict[str, str]
        Tool name aliases.
    
    Examples
    --------
    >>> registry = ToolRegistry()
    >>> registry.register(my_tool)
    >>> tool = registry.get("my_tool")
    """
    
    def __init__(self) -> None:
        self.tools: Dict[str, Tool] = {}
        self.aliases: Dict[str, str] = {}
        self._categories: Dict[str, Set[str]] = {}
    
    def register(
        self,
        tool: Union[Tool, ToolBase],
        aliases: Optional[List[str]] = None,
        category: Optional[str] = None,
    ) -> None:
        """
        Register a tool.
        
        Parameters
        ----------
        tool : Union[Tool, ToolBase]
            Tool to register.
        aliases : Optional[List[str]]
            Optional aliases for the tool.
        category : Optional[str]
            Optional category for organization.
        
        Raises
        ------
        ToolError
            If a tool with the same name already exists.
        """
        if isinstance(tool, ToolBase):
            tool = tool.get_tool()
        
        name = tool.schema.name
        
        if name in self.tools:
            raise ToolError(
                message=f"Tool '{name}' is already registered",
                tool_name=name,
            )
        
        self.tools[name] = tool
        
        if aliases:
            for alias in aliases:
                self.aliases[alias] = name
        
        if category:
            if category not in self._categories:
                self._categories[category] = set()
            self._categories[category].add(name)
        
        _logger.debug(f"Registered tool: {name}")
    
    def unregister(self, name: str) -> None:
        """
        Unregister a tool.
        
        Parameters
        ----------
        name : str
            Name of the tool to unregister.
        """
        # Resolve alias if needed
        actual_name = self.aliases.get(name, name)
        
        self.tools.pop(actual_name, None)
        
        # Remove aliases
        aliases_to_remove = [
            alias for alias, target in self.aliases.items()
            if target == actual_name
        ]
        for alias in aliases_to_remove:
            del self.aliases[alias]
        
        # Remove from categories
        for category_tools in self._categories.values():
            category_tools.discard(actual_name)
        
        _logger.debug(f"Unregistered tool: {name}")
    
    def get(self, name: str) -> Tool:
        """
        Get a tool by name.
        
        Parameters
        ----------
        name : str
            Tool name or alias.
        
        Returns
        -------
        Tool
            The requested tool.
        
        Raises
        ------
        ToolNotFoundError
            If the tool is not found.
        """
        # Resolve alias
        actual_name = self.aliases.get(name, name)
        
        tool = self.tools.get(actual_name)
        
        if tool is None:
            raise ToolNotFoundError(
                tool_name=name,
                available_tools=list(self.tools.keys()),
            )
        
        return tool
    
    def has(self, name: str) -> bool:
        """Check if a tool exists."""
        actual_name = self.aliases.get(name, name)
        return actual_name in self.tools
    
    def list_tools(self) -> List[str]:
        """Get list of all registered tool names."""
        return list(self.tools.keys())
    
    def get_tools_by_category(self, category: str) -> List[Tool]:
        """Get all tools in a category."""
        names = self._categories.get(category, set())
        return [self.tools[name] for name in names if name in self.tools]
    
    def get_schemas(self) -> List[Dict[str, Any]]:
        """Get schemas for all tools."""
        return [tool.schema.to_dict() for tool in self.tools.values()]
    
    def clear(self) -> None:
        """Remove all registered tools."""
        self.tools.clear()
        self.aliases.clear()
        self._categories.clear()


class ToolBuilder:
    """
    Builder for creating tools with a fluent API.
    
    Provides a convenient way to define tools programmatically
    without creating a subclass.
    
    Examples
    --------
    >>> tool = (ToolBuilder("calculator")
    ...     .with_description("Perform calculations")
    ...     .with_parameter("expression", "string", "Math expression")
    ...     .with_handler(lambda expression: eval(expression))
    ...     .build())
    """
    
    def __init__(self, name: str) -> None:
        self._name = name
        self._description: str = ""
        self._parameters: List[ToolParameter] = []
        self._permissions: List[Permission] = []
        self._handler: Optional[Callable[..., Any]] = None
        self._timeout_ms: int = 30000
        self._cacheable: bool = False
        self._tags: Set[str] = set()
    
    def with_description(self, description: str) -> "ToolBuilder":
        """Set the tool description."""
        self._description = description
        return self
    
    def with_parameter(
        self,
        name: str,
        type: str = "string",
        description: str = "",
        required: bool = True,
        default: Any = None,
        enum: Optional[List[Any]] = None,
        min_value: Optional[Union[int, float]] = None,
        max_value: Optional[Union[int, float]] = None,
        pattern: Optional[str] = None,
    ) -> "ToolBuilder":
        """Add a parameter to the tool."""
        param = ToolParameter(
            name=name,
            type=type,
            description=description,
            required=required,
            default=default,
            enum=enum,
            min_value=min_value,
            max_value=max_value,
            pattern=pattern,
        )
        self._parameters.append(param)
        return self
    
    def with_permission(
        self,
        resource: str,
        action: Union[PermissionAction, str] = PermissionAction.READ,
        effect: PermissionEffect = PermissionEffect.ALLOW,
    ) -> "ToolBuilder":
        """Add a required permission."""
        if isinstance(action, str):
            action = PermissionAction(action)
        
        permission = Permission(
            resource=resource,
            action=action,
            effect=effect,
        )
        self._permissions.append(permission)
        return self
    
    def with_handler(
        self,
        handler: Callable[..., Any],
    ) -> "ToolBuilder":
        """Set the tool handler function."""
        self._handler = handler
        return self
    
    def with_timeout(self, timeout_ms: int) -> "ToolBuilder":
        """Set the execution timeout."""
        self._timeout_ms = timeout_ms
        return self
    
    def with_cacheable(self, cacheable: bool = True) -> "ToolBuilder":
        """Set whether results are cacheable."""
        self._cacheable = cacheable
        return self
    
    def with_tag(self, tag: str) -> "ToolBuilder":
        """Add a tag to the tool."""
        self._tags.add(tag)
        return self
    
    def with_tags(self, *tags: str) -> "ToolBuilder":
        """Add multiple tags to the tool."""
        self._tags.update(tags)
        return self
    
    def build(self) -> Tool:
        """Build the tool instance."""
        if self._handler is None:
            raise ToolError(
                message="Tool handler is required",
                tool_name=self._name,
            )
        
        schema = ToolSchema(
            name=self._name,
            description=self._description,
            parameters=self._parameters,
        )
        
        return Tool(
            schema=schema,
            handler=self._handler,
            permissions=self._permissions,
            timeout_ms=self._timeout_ms,
            cacheable=self._cacheable,
            tags=self._tags,
        )


def register_tool(
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """
    Decorator to register a function as a tool.
    
    Parameters
    ----------
    name : Optional[str]
        Tool name (defaults to function name).
    description : Optional[str]
        Tool description (defaults to docstring).
    
    Returns
    -------
    Callable
        Decorated function.
    
    Examples
    --------
    >>> @register_tool(description="Add two numbers")
    ... def add(a: int, b: int) -> int:
    ...     return a + b
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        tool_name = name or func.__name__
        tool_description = description or func.__doc__ or ""
        
        # Extract parameters from function signature
        sig = inspect.signature(func)
        parameters = []
        
        for param_name, param in sig.parameters.items():
            param_type = "string"
            
            if param.annotation != inspect.Parameter.empty:
                type_map = {
                    str: "string",
                    int: "integer",
                    float: "number",
                    bool: "boolean",
                    list: "array",
                    dict: "object",
                }
                param_type = type_map.get(param.annotation, "string")
            
            required = param.default == inspect.Parameter.empty
            
            parameters.append(ToolParameter(
                name=param_name,
                type=param_type,
                description=f"Parameter {param_name}",
                required=required,
            ))
        
        # Create async wrapper if needed
        if asyncio.iscoroutinefunction(func):
            handler = func
        else:
            async def async_handler(**kwargs: Any) -> T:
                return func(**kwargs)
            handler = async_handler
        
        # Store tool info on function
        func._tool_name = tool_name  # type: ignore
        func._tool_schema = ToolSchema(  # type: ignore
            name=tool_name,
            description=tool_description,
            parameters=parameters,
        )
        func._tool_handler = handler  # type: ignore
        
        return func
    
    return decorator


def get_tool(func: Callable[..., Any]) -> Tool:
    """
    Create a Tool from a decorated function.
    
    Parameters
    ----------
    func : Callable
        Function decorated with @register_tool.
    
    Returns
    -------
    Tool
        Tool instance.
    """
    if not hasattr(func, "_tool_schema"):
        raise ToolError(
            message="Function is not a registered tool",
        )
    
    return Tool(
        schema=func._tool_schema,
        handler=func._tool_handler,
    )


# Global registry
_global_registry: Optional[ToolRegistry] = None


def get_global_registry() -> ToolRegistry:
    """Get the global tool registry."""
    global _global_registry
    if _global_registry is None:
        _global_registry = ToolRegistry()
    return _global_registry


def list_tools() -> List[str]:
    """List all tools in the global registry."""
    return get_global_registry().list_tools()

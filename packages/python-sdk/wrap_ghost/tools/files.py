"""
File system tools for the WRAP Ghost Python SDK.

This module provides tools for file system operations including
reading, writing, listing, and deleting files with proper
path validation and boundary enforcement.
"""

from __future__ import annotations

import aiofiles
import asyncio
import json
import logging
import os
import shutil
import stat
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import (
    Any,
    AsyncIterator,
    Dict,
    List,
    Optional,
    Set,
    Union,
)

from wrap_ghost.tools import ToolBase, ToolBuilder
from wrap_ghost.types import (
    FilesystemBoundary,
    Permission,
    PermissionAction,
    PermissionEffect,
    ToolParameter,
    ToolResult,
)
from wrap_ghost.exceptions import (
    PermissionDeniedError,
    ToolError,
    ToolExecutionError,
    ToolValidationError,
)

_logger = logging.getLogger("wrap_ghost.tools.files")


class PathValidator:
    """
    Validates and sanitizes file paths.
    
    Ensures paths are safe and within allowed boundaries.
    
    Attributes
    ----------
    allowed_extensions : Set[str]
        Set of allowed file extensions.
    blocked_patterns : List[str]
        Patterns that are always blocked.
    max_path_length : int
        Maximum path length.
    """
    
    def __init__(
        self,
        allowed_extensions: Optional[Set[str]] = None,
        blocked_patterns: Optional[List[str]] = None,
        max_path_length: int = 4096,
    ) -> None:
        self.allowed_extensions = allowed_extensions or set()
        self.blocked_patterns = blocked_patterns or [
            "**/.*",  # Hidden files
            "**/*~",  # Backup files
            "**/node_modules/**",
            "**/.git/**",
            "**/__pycache__/**",
        ]
        self.max_path_length = max_path_length
    
    def validate(self, path: str) -> Path:
        """
        Validate a path and return a Path object.
        
        Parameters
        ----------
        path : str
            Path to validate.
        
        Returns
        -------
        Path
            Validated Path object.
        
        Raises
        ------
        ToolValidationError
            If the path is invalid.
        """
        # Check path length
        if len(path) > self.max_path_length:
            raise ToolValidationError(
                message=f"Path exceeds maximum length of {self.max_path_length}",
                tool_name="file",
                validation_errors=[{"field": "path", "error": "too long"}],
            )
        
        # Normalize the path
        try:
            p = Path(path).resolve()
        except Exception as e:
            raise ToolValidationError(
                message=f"Invalid path: {e}",
                tool_name="file",
                validation_errors=[{"field": "path", "error": str(e)}],
            )
        
        # Check for parent directory traversal
        if ".." in str(p):
            raise ToolValidationError(
                message="Path cannot contain '..'",
                tool_name="file",
                validation_errors=[{"field": "path", "error": "parent traversal"}],
            )
        
        # Check blocked patterns
        import fnmatch
        for pattern in self.blocked_patterns:
            if fnmatch.fnmatch(str(p), pattern):
                raise ToolValidationError(
                    message=f"Path matches blocked pattern: {pattern}",
                    tool_name="file",
                    validation_errors=[{"field": "path", "error": "blocked pattern"}],
                )
        
        # Check extension
        if self.allowed_extensions:
            ext = p.suffix.lower()
            if ext and ext not in self.allowed_extensions:
                raise ToolValidationError(
                    message=f"File extension '{ext}' is not allowed",
                    tool_name="file",
                    validation_errors=[{"field": "path", "error": "extension not allowed"}],
                )
        
        return p
    
    def is_safe_path(self, path: str) -> bool:
        """Check if a path is safe without raising."""
        try:
            self.validate(path)
            return True
        except Exception:
            return False


class BoundaryEnforcer:
    """
    Enforces filesystem boundaries for file operations.
    
    Ensures that file operations stay within configured boundaries
    and don't violate security constraints.
    
    Attributes
    ----------
    boundary : FilesystemBoundary
        The boundary configuration.
    """
    
    def __init__(self, boundary: FilesystemBoundary) -> None:
        self.boundary = boundary
    
    def check_read(self, path: Path) -> bool:
        """Check if read access is allowed for a path."""
        return self.boundary.is_path_allowed(str(path), PermissionAction.READ)
    
    def check_write(self, path: Path) -> bool:
        """Check if write access is allowed for a path."""
        return self.boundary.is_path_allowed(str(path), PermissionAction.WRITE)
    
    def check_execute(self, path: Path) -> bool:
        """Check if execute access is allowed for a path."""
        return self.boundary.is_path_allowed(str(path), PermissionAction.EXECUTE)
    
    def check_delete(self, path: Path) -> bool:
        """Check if delete access is allowed for a path."""
        # Delete requires write permission
        return self.boundary.is_path_allowed(str(path), PermissionAction.WRITE)
    
    def enforce_read(self, path: Path) -> None:
        """Enforce read access or raise."""
        if not self.check_read(path):
            raise PermissionDeniedError(
                resource=str(path),
                action="read",
            )
    
    def enforce_write(self, path: Path) -> None:
        """Enforce write access or raise."""
        if not self.check_write(path):
            raise PermissionDeniedError(
                resource=str(path),
                action="write",
            )
    
    def enforce_execute(self, path: Path) -> None:
        """Enforce execute access or raise."""
        if not self.check_execute(path):
            raise PermissionDeniedError(
                resource=str(path),
                action="execute",
            )
    
    def enforce_delete(self, path: Path) -> None:
        """Enforce delete access or raise."""
        if not self.check_delete(path):
            raise PermissionDeniedError(
                resource=str(path),
                action="delete",
            )


@dataclass
class FileInfo:
    """Information about a file."""
    
    path: str
    name: str
    size: int
    is_dir: bool
    is_file: bool
    is_symlink: bool
    permissions: str
    modified_time: datetime
    created_time: Optional[datetime] = None
    accessed_time: Optional[datetime] = None
    mime_type: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "path": self.path,
            "name": self.name,
            "size": self.size,
            "is_dir": self.is_dir,
            "is_file": self.is_file,
            "is_symlink": self.is_symlink,
            "permissions": self.permissions,
            "modified_time": self.modified_time.isoformat(),
            "created_time": self.created_time.isoformat() if self.created_time else None,
            "accessed_time": self.accessed_time.isoformat() if self.accessed_time else None,
            "mime_type": self.mime_type,
        }


class FileTool(ToolBase):
    """
    Comprehensive file system tool.
    
    Provides operations for reading, writing, listing, and deleting
    files with proper validation and boundary enforcement.
    
    Attributes
    ----------
    name : str
        Tool name.
    description : str
        Tool description.
    base_path : Optional[Path]
        Base path for relative paths.
    boundary : Optional[FilesystemBoundary]
        Boundary configuration.
    
    Examples
    --------
    >>> tool = FileTool(base_path="/workspace")
    >>> content = await tool.execute(
    ...     operation="read",
    ...     path="example.txt",
    ... )
    """
    
    name = "file"
    description = "Perform file system operations including read, write, list, and delete"
    
    def __init__(
        self,
        base_path: Optional[Union[str, Path]] = None,
        boundary: Optional[FilesystemBoundary] = None,
        validator: Optional[PathValidator] = None,
    ) -> None:
        super().__init__()
        
        self.base_path = Path(base_path) if base_path else None
        self.boundary = boundary or FilesystemBoundary()
        self.validator = validator or PathValidator()
        self._enforcer = BoundaryEnforcer(self.boundary)
        
        # Define parameters
        self.parameters = [
            ToolParameter(
                name="operation",
                type="string",
                description="Operation to perform: read, write, list, delete, exists, mkdir, copy, move",
                required=True,
                enum=["read", "write", "list", "delete", "exists", "mkdir", "copy", "move"],
            ),
            ToolParameter(
                name="path",
                type="string",
                description="File or directory path",
                required=True,
            ),
            ToolParameter(
                name="content",
                type="string",
                description="Content to write (for write operation)",
                required=False,
            ),
            ToolParameter(
                name="dest",
                type="string",
                description="Destination path (for copy/move operations)",
                required=False,
            ),
            ToolParameter(
                name="recursive",
                type="boolean",
                description="Whether to operate recursively",
                required=False,
                default=False,
            ),
            ToolParameter(
                name="encoding",
                type="string",
                description="File encoding (default: utf-8)",
                required=False,
                default="utf-8",
            ),
            ToolParameter(
                name="max_size",
                type="integer",
                description="Maximum file size to read (in bytes)",
                required=False,
            ),
        ]
        
        # Define permissions
        self.permissions = [
            Permission(
                resource="filesystem",
                action=PermissionAction.ALL,
                effect=PermissionEffect.ALLOW,
            ),
        ]
    
    def _resolve_path(self, path: str) -> Path:
        """Resolve and validate a path."""
        p = self.validator.validate(path)
        
        if self.base_path and not p.is_absolute():
            p = (self.base_path / p).resolve()
        
        return p
    
    async def execute(self, **kwargs: Any) -> Dict[str, Any]:
        """
        Execute a file operation.
        
        Parameters
        ----------
        operation : str
            Operation to perform.
        path : str
            File or directory path.
        **kwargs : Any
            Additional arguments.
        
        Returns
        -------
        Dict[str, Any]
            Operation result.
        """
        operation = kwargs.get("operation")
        path = kwargs.get("path", "")
        
        # Validate arguments
        errors = self.validate_arguments(**kwargs)
        if errors:
            raise ToolValidationError(
                message="Invalid arguments",
                tool_name=self.name,
                validation_errors=[{"error": e} for e in errors],
            )
        
        # Resolve and validate path
        resolved_path = self._resolve_path(path)
        
        # Execute operation
        handlers = {
            "read": self._read,
            "write": self._write,
            "list": self._list,
            "delete": self._delete,
            "exists": self._exists,
            "mkdir": self._mkdir,
            "copy": self._copy,
            "move": self._move,
        }
        
        handler = handlers.get(operation)
        if handler is None:
            raise ToolValidationError(
                message=f"Unknown operation: {operation}",
                tool_name=self.name,
            )
        
        try:
            return await handler(resolved_path, **kwargs)
        except PermissionDeniedError:
            raise
        except Exception as e:
            raise ToolExecutionError(
                message=str(e),
                tool_name=self.name,
                arguments=kwargs,
            )
    
    async def _read(
        self,
        path: Path,
        encoding: str = "utf-8",
        max_size: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Read file contents."""
        self._enforcer.enforce_read(path)
        
        if not path.exists():
            raise ToolExecutionError(
                message=f"File not found: {path}",
                tool_name=self.name,
            )
        
        if not path.is_file():
            raise ToolExecutionError(
                message=f"Not a file: {path}",
                tool_name=self.name,
            )
        
        # Check file size
        size = path.stat().st_size
        if max_size and size > max_size:
            raise ToolExecutionError(
                message=f"File too large: {size} bytes (max: {max_size})",
                tool_name=self.name,
            )
        
        # Read content
        async with aiofiles.open(path, "r", encoding=encoding) as f:
            content = await f.read()
        
        return {
            "success": True,
            "path": str(path),
            "content": content,
            "size": size,
        }
    
    async def _write(
        self,
        path: Path,
        content: str = "",
        encoding: str = "utf-8",
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Write content to file."""
        self._enforcer.enforce_write(path)
        
        # Ensure parent directory exists
        path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write content
        async with aiofiles.open(path, "w", encoding=encoding) as f:
            await f.write(content)
        
        return {
            "success": True,
            "path": str(path),
            "size": len(content.encode(encoding)),
        }
    
    async def _list(
        self,
        path: Path,
        recursive: bool = False,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """List directory contents."""
        self._enforcer.enforce_read(path)
        
        if not path.exists():
            raise ToolExecutionError(
                message=f"Path not found: {path}",
                tool_name=self.name,
            )
        
        if not path.is_dir():
            raise ToolExecutionError(
                message=f"Not a directory: {path}",
                tool_name=self.name,
            )
        
        files = []
        
        if recursive:
            for item in path.rglob("*"):
                try:
                    info = await self._get_file_info(item)
                    files.append(info)
                except Exception as e:
                    _logger.warning(f"Error getting info for {item}: {e}")
        else:
            for item in path.iterdir():
                try:
                    info = await self._get_file_info(item)
                    files.append(info)
                except Exception as e:
                    _logger.warning(f"Error getting info for {item}: {e}")
        
        return {
            "success": True,
            "path": str(path),
            "files": [f.to_dict() for f in files],
            "count": len(files),
        }
    
    async def _delete(
        self,
        path: Path,
        recursive: bool = False,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Delete a file or directory."""
        self._enforcer.enforce_delete(path)
        
        if not path.exists():
            raise ToolExecutionError(
                message=f"Path not found: {path}",
                tool_name=self.name,
            )
        
        if path.is_file():
            path.unlink()
        elif path.is_dir():
            if recursive:
                shutil.rmtree(path)
            else:
                path.rmdir()
        
        return {
            "success": True,
            "path": str(path),
        }
    
    async def _exists(
        self,
        path: Path,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Check if a path exists."""
        # Only need read permission to check existence
        self._enforcer.enforce_read(path.parent)
        
        return {
            "success": True,
            "path": str(path),
            "exists": path.exists(),
            "is_file": path.is_file() if path.exists() else False,
            "is_dir": path.is_dir() if path.exists() else False,
        }
    
    async def _mkdir(
        self,
        path: Path,
        recursive: bool = True,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Create a directory."""
        self._enforcer.enforce_write(path.parent if not recursive else path)
        
        path.mkdir(parents=recursive, exist_ok=True)
        
        return {
            "success": True,
            "path": str(path),
        }
    
    async def _copy(
        self,
        path: Path,
        dest: str = "",
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Copy a file or directory."""
        dest_path = self._resolve_path(dest)
        
        self._enforcer.enforce_read(path)
        self._enforcer.enforce_write(dest_path.parent)
        
        if not path.exists():
            raise ToolExecutionError(
                message=f"Source not found: {path}",
                tool_name=self.name,
            )
        
        if path.is_file():
            shutil.copy2(path, dest_path)
        else:
            shutil.copytree(path, dest_path)
        
        return {
            "success": True,
            "source": str(path),
            "destination": str(dest_path),
        }
    
    async def _move(
        self,
        path: Path,
        dest: str = "",
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Move a file or directory."""
        dest_path = self._resolve_path(dest)
        
        self._enforcer.enforce_read(path)
        self._enforcer.enforce_write(path.parent)
        self._enforcer.enforce_write(dest_path.parent)
        
        if not path.exists():
            raise ToolExecutionError(
                message=f"Source not found: {path}",
                tool_name=self.name,
            )
        
        shutil.move(str(path), str(dest_path))
        
        return {
            "success": True,
            "source": str(path),
            "destination": str(dest_path),
        }
    
    async def _get_file_info(self, path: Path) -> FileInfo:
        """Get information about a file."""
        stat_info = path.stat()
        
        # Determine mime type
        mime_type = None
        if path.is_file():
            import mimetypes
            mime_type, _ = mimetypes.guess_type(str(path))
        
        return FileInfo(
            path=str(path),
            name=path.name,
            size=stat_info.st_size,
            is_dir=path.is_dir(),
            is_file=path.is_file(),
            is_symlink=path.is_symlink(),
            permissions=stat.filemode(stat_info.st_mode),
            modified_time=datetime.fromtimestamp(stat_info.st_mtime),
            created_time=datetime.fromtimestamp(stat_info.st_ctime),
            accessed_time=datetime.fromtimestamp(stat_info.st_atime),
            mime_type=mime_type,
        )


class FileReaderTool(ToolBase):
    """Tool for reading files."""
    
    name = "file_read"
    description = "Read contents from a file"
    
    def __init__(
        self,
        base_path: Optional[Union[str, Path]] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._file_tool = FileTool(base_path=base_path)
        self.parameters = [
            ToolParameter(
                name="path",
                type="string",
                description="File path to read",
                required=True,
            ),
            ToolParameter(
                name="encoding",
                type="string",
                description="File encoding",
                required=False,
                default="utf-8",
            ),
            ToolParameter(
                name="max_size",
                type="integer",
                description="Maximum file size in bytes",
                required=False,
            ),
        ]
    
    async def execute(self, **kwargs: Any) -> Dict[str, Any]:
        """Read a file."""
        kwargs["operation"] = "read"
        return await self._file_tool.execute(**kwargs)


class FileWriterTool(ToolBase):
    """Tool for writing files."""
    
    name = "file_write"
    description = "Write content to a file"
    
    def __init__(
        self,
        base_path: Optional[Union[str, Path]] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._file_tool = FileTool(base_path=base_path)
        self.parameters = [
            ToolParameter(
                name="path",
                type="string",
                description="File path to write",
                required=True,
            ),
            ToolParameter(
                name="content",
                type="string",
                description="Content to write",
                required=True,
            ),
            ToolParameter(
                name="encoding",
                type="string",
                description="File encoding",
                required=False,
                default="utf-8",
            ),
        ]
    
    async def execute(self, **kwargs: Any) -> Dict[str, Any]:
        """Write to a file."""
        kwargs["operation"] = "write"
        return await self._file_tool.execute(**kwargs)


class FileListTool(ToolBase):
    """Tool for listing directory contents."""
    
    name = "file_list"
    description = "List contents of a directory"
    
    def __init__(
        self,
        base_path: Optional[Union[str, Path]] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._file_tool = FileTool(base_path=base_path)
        self.parameters = [
            ToolParameter(
                name="path",
                type="string",
                description="Directory path to list",
                required=True,
            ),
            ToolParameter(
                name="recursive",
                type="boolean",
                description="List recursively",
                required=False,
                default=False,
            ),
        ]
    
    async def execute(self, **kwargs: Any) -> Dict[str, Any]:
        """List directory contents."""
        kwargs["operation"] = "list"
        return await self._file_tool.execute(**kwargs)


class FileDeleteTool(ToolBase):
    """Tool for deleting files and directories."""
    
    name = "file_delete"
    description = "Delete a file or directory"
    
    def __init__(
        self,
        base_path: Optional[Union[str, Path]] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._file_tool = FileTool(base_path=base_path)
        self.parameters = [
            ToolParameter(
                name="path",
                type="string",
                description="Path to delete",
                required=True,
            ),
            ToolParameter(
                name="recursive",
                type="boolean",
                description="Delete recursively",
                required=False,
                default=False,
            ),
        ]
    
    async def execute(self, **kwargs: Any) -> Dict[str, Any]:
        """Delete a file or directory."""
        kwargs["operation"] = "delete"
        return await self._file_tool.execute(**kwargs)


# Streaming file reader
async def stream_file(
    path: str,
    chunk_size: int = 8192,
    encoding: str = "utf-8",
) -> AsyncIterator[str]:
    """
    Stream file contents in chunks.
    
    Parameters
    ----------
    path : str
        File path to stream.
    chunk_size : int
        Size of each chunk in bytes.
    encoding : str
        File encoding.
    
    Yields
    ------
    str
        File content chunks.
    """
    async with aiofiles.open(path, "r", encoding=encoding) as f:
        while True:
            chunk = await f.read(chunk_size)
            if not chunk:
                break
            yield chunk


# Utility function to get file tool with custom boundary
def create_file_tool(
    base_path: Optional[str] = None,
    read_paths: Optional[Set[str]] = None,
    write_paths: Optional[Set[str]] = None,
) -> FileTool:
    """
    Create a file tool with custom boundaries.
    
    Parameters
    ----------
    base_path : Optional[str]
        Base path for relative paths.
    read_paths : Optional[Set[str]]
        Allowed read paths.
    write_paths : Optional[Set[str]]
        Allowed write paths.
    
    Returns
    -------
    FileTool
        Configured file tool.
    """
    boundary = FilesystemBoundary(
        read_paths=read_paths or set(),
        write_paths=write_paths or set(),
    )
    
    return FileTool(
        base_path=base_path,
        boundary=boundary,
    )

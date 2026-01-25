"""
Utility functions and helpers for the WRAP Ghost Python SDK.

This module provides logging utilities, retry logic, async helpers,
validation functions, and other common utilities used throughout the SDK.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import inspect
import json
import logging
import os
import random
import re
import sys
import time
import traceback
import uuid
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import (
    Any,
    AsyncContextManager,
    AsyncGenerator,
    Awaitable,
    Callable,
    Dict,
    Generic,
    List,
    Optional,
    Protocol,
    Sequence,
    Set,
    Tuple,
    Type,
    TypeVar,
    Union,
    cast,
    runtime_checkable,
)

from wrap_ghost.exceptions import (
    ValidationError,
    ValidationFailedError,
    WRAPErr,
    is_retryable_error,
)

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)


# ============================================================================
# Logging Utilities
# ============================================================================


class LogFormatter(logging.Formatter):
    """
    Custom log formatter with color support and structured output.
    
    Provides formatted log messages with timestamps, log levels,
    and optional color coding for terminal output.
    
    Attributes
    ----------
    use_colors : bool
        Whether to use ANSI color codes.
    include_context : bool
        Whether to include extra context in output.
    """
    
    COLORS = {
        "DEBUG": "\033[36m",     # Cyan
        "INFO": "\033[32m",      # Green
        "WARNING": "\033[33m",   # Yellow
        "ERROR": "\033[31m",     # Red
        "CRITICAL": "\033[35m",  # Magenta
    }
    RESET = "\033[0m"
    
    def __init__(
        self,
        fmt: Optional[str] = None,
        datefmt: Optional[str] = None,
        use_colors: bool = True,
        include_context: bool = False,
    ) -> None:
        if fmt is None:
            fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        if datefmt is None:
            datefmt = "%Y-%m-%d %H:%M:%S"
        
        super().__init__(fmt=fmt, datefmt=datefmt)
        self.use_colors = use_colors and self._supports_color()
        self.include_context = include_context
    
    @staticmethod
    def _supports_color() -> bool:
        """Check if the terminal supports colors."""
        if sys.platform == "win32":
            return os.environ.get("ANSICON") is not None
        
        if not hasattr(sys.stdout, "isatty"):
            return False
        
        if not sys.stdout.isatty():
            return False
        
        return True
    
    def format(self, record: logging.LogRecord) -> str:
        """Format the log record."""
        if self.use_colors:
            color = self.COLORS.get(record.levelname, "")
            record.levelname = f"{color}{record.levelname}{self.RESET}"
        
        message = super().format(record)
        
        if self.include_context and hasattr(record, "context"):
            context_str = json.dumps(record.context, default=str)
            message = f"{message}\n  Context: {context_str}"
        
        return message


def setup_logging(
    level: Union[str, int] = logging.INFO,
    format_string: Optional[str] = None,
    date_format: Optional[str] = None,
    use_colors: bool = True,
    log_file: Optional[str] = None,
) -> None:
    """
    Configure logging for the WRAP Ghost SDK.
    
    Parameters
    ----------
    level : Union[str, int]
        Log level. Can be string ("DEBUG", "INFO", etc.) or logging constant.
    format_string : Optional[str]
        Custom format string for log messages.
    date_format : Optional[str]
        Custom format string for dates.
    use_colors : bool
        Whether to use ANSI colors in terminal output.
    log_file : Optional[str]
        Path to log file for persistent logging.
    
    Examples
    --------
    >>> setup_logging(level="DEBUG", log_file="wrap.log")
    """
    if isinstance(level, str):
        level = getattr(logging, level.upper(), logging.INFO)
    
    formatter = LogFormatter(
        fmt=format_string,
        datefmt=date_format,
        use_colors=use_colors,
    )
    
    # Configure root logger for wrap_ghost
    logger = logging.getLogger("wrap_ghost")
    logger.setLevel(level)
    
    # Remove existing handlers
    logger.handlers.clear()
    
    # Add console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # Add file handler if specified
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(LogFormatter(
            fmt=format_string,
            datefmt=date_format,
            use_colors=False,
        ))
        logger.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a module.
    
    Parameters
    ----------
    name : str
        Name of the logger, typically __name__.
    
    Returns
    -------
    logging.Logger
        Configured logger instance.
    
    Examples
    --------
    >>> logger = get_logger(__name__)
    >>> logger.info("Operation completed")
    """
    return logging.getLogger(f"wrap_ghost.{name}")


# ============================================================================
# Retry Logic
# ============================================================================


class BackoffStrategy(str, Enum):
    """Enumeration of backoff strategies."""
    
    EXPONENTIAL = "exponential"
    LINEAR = "linear"
    CONSTANT = "constant"
    FIBONACCI = "fibonacci"


@dataclass
class RetryPolicy:
    """
    Policy for retrying failed operations.
    
    Defines when and how to retry operations that fail,
    including backoff strategies and maximum attempts.
    
    Attributes
    ----------
    max_attempts : int
        Maximum number of retry attempts.
    initial_delay : float
        Initial delay before first retry in seconds.
    max_delay : float
        Maximum delay between retries in seconds.
    exponential_base : float
        Base for exponential backoff.
    strategy : BackoffStrategy
        Backoff strategy to use.
    jitter : bool
        Whether to add random jitter to delays.
    retryable_exceptions : Tuple[Type[Exception], ...]
        Exception types that should trigger retry.
    on_retry : Optional[Callable[[int, Exception], None]]
        Callback called on each retry.
    """
    
    max_attempts: int = 3
    initial_delay: float = 0.1
    max_delay: float = 30.0
    exponential_base: float = 2.0
    strategy: BackoffStrategy = BackoffStrategy.EXPONENTIAL
    jitter: bool = True
    retryable_exceptions: Tuple[Type[Exception], ...] = (
        ConnectionError,
        TimeoutError,
    )
    on_retry: Optional[Callable[[int, Exception], None]] = None
    
    def calculate_delay(self, attempt: int) -> float:
        """Calculate the delay for a given attempt number."""
        if self.strategy == BackoffStrategy.EXPONENTIAL:
            delay = self.initial_delay * (self.exponential_base ** attempt)
        elif self.strategy == BackoffStrategy.LINEAR:
            delay = self.initial_delay * (attempt + 1)
        elif self.strategy == BackoffStrategy.FIBONACCI:
            fib = self._fibonacci(attempt + 1)
            delay = self.initial_delay * fib
        else:
            delay = self.initial_delay
        
        # Apply max delay cap
        delay = min(delay, self.max_delay)
        
        # Add jitter if enabled
        if self.jitter:
            delay = delay * (0.5 + random.random())
        
        return delay
    
    @staticmethod
    def _fibonacci(n: int) -> int:
        """Calculate nth Fibonacci number."""
        if n <= 1:
            return n
        a, b = 0, 1
        for _ in range(2, n + 1):
            a, b = b, a + b
        return b
    
    def should_retry(self, exception: Exception, attempt: int) -> bool:
        """Determine if the operation should be retried."""
        if attempt >= self.max_attempts:
            return False
        
        if isinstance(exception, self.retryable_exceptions):
            return True
        
        if isinstance(exception, WRAPErr):
            return exception.recoverable
        
        return is_retryable_error(exception)


@dataclass
class RetryContext:
    """Context for tracking retry state."""
    
    attempt: int = 0
    last_exception: Optional[Exception] = None
    total_delay: float = 0.0
    start_time: float = field(default_factory=time.time)


def retry(
    policy: Optional[RetryPolicy] = None,
    **policy_kwargs: Any,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """
    Decorator for retrying synchronous functions.
    
    Parameters
    ----------
    policy : Optional[RetryPolicy]
        Retry policy configuration.
    **policy_kwargs : Any
        Keyword arguments to create a RetryPolicy if none provided.
    
    Returns
    -------
    Callable
        Decorated function with retry logic.
    
    Examples
    --------
    >>> @retry(max_attempts=3, initial_delay=0.5)
    ... def unreliable_operation():
    ...     # Might fail occasionally
    ...     pass
    """
    if policy is None:
        policy = RetryPolicy(**policy_kwargs)
    
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            ctx = RetryContext()
            
            while True:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    ctx.attempt += 1
                    ctx.last_exception = e
                    
                    if not policy.should_retry(e, ctx.attempt):
                        raise
                    
                    delay = policy.calculate_delay(ctx.attempt - 1)
                    ctx.total_delay += delay
                    
                    if policy.on_retry:
                        policy.on_retry(ctx.attempt, e)
                    
                    time.sleep(delay)
        
        return wrapper
    
    return decorator


def async_retry(
    policy: Optional[RetryPolicy] = None,
    **policy_kwargs: Any,
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """
    Decorator for retrying async functions.
    
    Parameters
    ----------
    policy : Optional[RetryPolicy]
        Retry policy configuration.
    **policy_kwargs : Any
        Keyword arguments to create a RetryPolicy if none provided.
    
    Returns
    -------
    Callable
        Decorated async function with retry logic.
    
    Examples
    --------
    >>> @async_retry(max_attempts=3)
    ... async def unreliable_async_operation():
    ...     # Might fail occasionally
    ...     pass
    """
    if policy is None:
        policy = RetryPolicy(**policy_kwargs)
    
    def decorator(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            ctx = RetryContext()
            
            while True:
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    ctx.attempt += 1
                    ctx.last_exception = e
                    
                    if not policy.should_retry(e, ctx.attempt):
                        raise
                    
                    delay = policy.calculate_delay(ctx.attempt - 1)
                    ctx.total_delay += delay
                    
                    if policy.on_retry:
                        policy.on_retry(ctx.attempt, e)
                    
                    await asyncio.sleep(delay)
        
        return wrapper
    
    return decorator


# ============================================================================
# Async Utilities
# ============================================================================


@asynccontextmanager
async def async_timeout(
    seconds: float,
    message: str = "Operation timed out",
) -> AsyncGenerator[None, None]:
    """
    Context manager for async timeout.
    
    Parameters
    ----------
    seconds : float
        Timeout in seconds.
    message : str
        Error message if timeout occurs.
    
    Yields
    ------
    None
    
    Raises
    ------
    asyncio.TimeoutError
        If the operation exceeds the timeout.
    
    Examples
    --------
    >>> async with async_timeout(30):
    ...     await long_running_operation()
    """
    try:
        async with asyncio.timeout(seconds):
            yield
    except asyncio.TimeoutError:
        raise asyncio.TimeoutError(message)


class AsyncContextManager(Generic[T]):
    """
    Base class for async context managers.
    
    Provides a template for creating async context managers
    with proper resource cleanup.
    """
    
    async def __aenter__(self) -> T:
        """Enter the context manager."""
        raise NotImplementedError
    
    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[Any],
    ) -> None:
        """Exit the context manager."""
        pass


class AsyncTaskGroup:
    """
    Group for managing multiple async tasks.
    
    Provides utilities for creating, tracking, and waiting on
    multiple concurrent async tasks.
    
    Attributes
    ----------
    max_concurrency : int
        Maximum number of concurrent tasks.
    tasks : List[asyncio.Task]
        List of created tasks.
    """
    
    def __init__(self, max_concurrency: int = 10) -> None:
        self.max_concurrency = max_concurrency
        self.tasks: List[asyncio.Task] = []
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._results: List[Any] = []
    
    async def __aenter__(self) -> "AsyncTaskGroup":
        return self
    
    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[Any],
    ) -> None:
        await self.wait_all()
    
    def create_task(
        self,
        coro: Awaitable[T],
        name: Optional[str] = None,
    ) -> asyncio.Task:
        """
        Create a new task in the group.
        
        Parameters
        ----------
        coro : Awaitable
            Coroutine to run.
        name : Optional[str]
            Optional name for the task.
        
        Returns
        -------
        asyncio.Task
            The created task.
        """
        task = asyncio.create_task(coro)
        if name:
            task.set_name(name)
        self.tasks.append(task)
        return task
    
    async def wait_all(self) -> List[Any]:
        """Wait for all tasks to complete and return results."""
        if not self.tasks:
            return []
        
        results = await asyncio.gather(*self.tasks, return_exceptions=True)
        self._results = results
        return results
    
    async def cancel_all(self) -> None:
        """Cancel all tasks in the group."""
        for task in self.tasks:
            if not task.done():
                task.cancel()
        
        await asyncio.gather(*self.tasks, return_exceptions=True)
    
    def get_errors(self) -> List[Exception]:
        """Get all errors from completed tasks."""
        return [
            r for r in self._results
            if isinstance(r, Exception)
        ]


async def gather_with_concurrency(
    *coros: Awaitable[T],
    limit: int = 10,
    return_exceptions: bool = False,
) -> List[Union[T, Exception]]:
    """
    Run coroutines with limited concurrency.
    
    Parameters
    ----------
    *coros : Awaitable
        Coroutines to run.
    limit : int
        Maximum concurrent coroutines.
    return_exceptions : bool
        Whether to return exceptions instead of raising.
    
    Returns
    -------
    List[Union[T, Exception]]
        Results from the coroutines.
    
    Examples
    --------
    >>> results = await gather_with_concurrency(
    ...     fetch_url(url1),
    ...     fetch_url(url2),
    ...     limit=5,
    ... )
    """
    semaphore = asyncio.Semaphore(limit)
    
    async def limited_coro(coro: Awaitable[T]) -> Union[T, Exception]:
        async with semaphore:
            try:
                return await coro
            except Exception as e:
                if return_exceptions:
                    return e
                raise
    
    return await asyncio.gather(
        *[limited_coro(c) for c in coros],
        return_exceptions=return_exceptions,
    )


# ============================================================================
# Validation Helpers
# ============================================================================


def validate_type(
    value: Any,
    expected_type: Union[Type, Tuple[Type, ...]],
    name: str = "value",
) -> None:
    """
    Validate that a value is of the expected type.
    
    Parameters
    ----------
    value : Any
        Value to validate.
    expected_type : Union[Type, Tuple[Type, ...]]
        Expected type or types.
    name : str
        Name of the value for error messages.
    
    Raises
    ------
    ValidationError
        If the value is not of the expected type.
    
    Examples
    --------
    >>> validate_type("hello", str)
    >>> validate_type(42, (int, float))
    """
    if not isinstance(value, expected_type):
        type_name = (
            " or ".join(t.__name__ for t in expected_type)
            if isinstance(expected_type, tuple)
            else expected_type.__name__
        )
        raise ValidationError(
            message=f"{name} must be of type {type_name}, got {type(value).__name__}",
            field=name,
            value=value,
        )


def validate_range(
    value: Union[int, float],
    min_value: Optional[Union[int, float]] = None,
    max_value: Optional[Union[int, float]] = None,
    name: str = "value",
) -> None:
    """
    Validate that a numeric value is within a range.
    
    Parameters
    ----------
    value : Union[int, float]
        Value to validate.
    min_value : Optional[Union[int, float]]
        Minimum allowed value.
    max_value : Optional[Union[int, float]]
        Maximum allowed value.
    name : str
        Name of the value for error messages.
    
    Raises
    ------
    ValidationError
        If the value is outside the allowed range.
    
    Examples
    --------
    >>> validate_range(5, min_value=0, max_value=10)
    """
    if min_value is not None and value < min_value:
        raise ValidationError(
            message=f"{name} must be >= {min_value}, got {value}",
            field=name,
            value=value,
        )
    
    if max_value is not None and value > max_value:
        raise ValidationError(
            message=f"{name} must be <= {max_value}, got {value}",
            field=name,
            value=value,
        )


def validate_path(
    path: str,
    must_exist: bool = False,
    allow_absolute: bool = True,
    allow_parent_refs: bool = False,
    name: str = "path",
) -> Path:
    """
    Validate a filesystem path.
    
    Parameters
    ----------
    path : str
        Path to validate.
    must_exist : bool
        Whether the path must exist.
    allow_absolute : bool
        Whether to allow absolute paths.
    allow_parent_refs : bool
        Whether to allow ".." in the path.
    name : str
        Name of the path for error messages.
    
    Returns
    -------
    Path
        The validated path object.
    
    Raises
    ------
    ValidationError
        If the path is invalid.
    """
    try:
        p = Path(path)
    except Exception as e:
        raise ValidationError(
            message=f"Invalid path: {e}",
            field=name,
            value=path,
        )
    
    if not allow_absolute and p.is_absolute():
        raise ValidationError(
            message=f"{name} must not be an absolute path",
            field=name,
            value=path,
        )
    
    if not allow_parent_refs and ".." in p.parts:
        raise ValidationError(
            message=f"{name} must not contain parent references",
            field=name,
            value=path,
        )
    
    if must_exist and not p.exists():
        raise ValidationError(
            message=f"{name} does not exist: {path}",
            field=name,
            value=path,
        )
    
    return p


def validate_url(
    url: str,
    allowed_schemes: Optional[Set[str]] = None,
    name: str = "url",
) -> str:
    """
    Validate a URL.
    
    Parameters
    ----------
    url : str
        URL to validate.
    allowed_schemes : Optional[Set[str]]
        Allowed URL schemes (e.g., {"http", "https"}).
    name : str
        Name of the URL for error messages.
    
    Returns
    -------
    str
        The validated URL.
    
    Raises
    ------
    ValidationError
        If the URL is invalid.
    """
    from urllib.parse import urlparse
    
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise ValidationError(
            message=f"Invalid URL: {e}",
            field=name,
            value=url,
        )
    
    if not parsed.scheme:
        raise ValidationError(
            message=f"{name} must include a scheme",
            field=name,
            value=url,
        )
    
    if not parsed.netloc:
        raise ValidationError(
            message=f"{name} must include a host",
            field=name,
            value=url,
        )
    
    if allowed_schemes and parsed.scheme.lower() not in allowed_schemes:
        raise ValidationError(
            message=f"{name} must use one of: {', '.join(allowed_schemes)}",
            field=name,
            value=url,
        )
    
    return url


def validate_json(
    value: str,
    name: str = "json",
) -> Any:
    """
    Validate and parse a JSON string.
    
    Parameters
    ----------
    value : str
        JSON string to validate.
    name : str
        Name of the value for error messages.
    
    Returns
    -------
    Any
        The parsed JSON value.
    
    Raises
    ------
    ValidationError
        If the string is not valid JSON.
    """
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        raise ValidationError(
            message=f"Invalid JSON: {e}",
            field=name,
            value=value,
        )


# ============================================================================
# General Utilities
# ============================================================================


def generate_id(
    prefix: Optional[str] = None,
    length: int = 32,
) -> str:
    """
    Generate a unique identifier.
    
    Parameters
    ----------
    prefix : Optional[str]
        Optional prefix for the ID.
    length : int
        Length of the random portion.
    
    Returns
    -------
    str
        A unique identifier string.
    
    Examples
    --------
    >>> generate_id("sandbox")
    'sandbox_a1b2c3d4e5f6g7h8'
    """
    random_part = uuid.uuid4().hex[:length]
    
    if prefix:
        return f"{prefix}_{random_part}"
    
    return random_part


def timestamp_now(
    milliseconds: bool = False,
) -> Union[int, float]:
    """
    Get the current timestamp.
    
    Parameters
    ----------
    milliseconds : bool
        Whether to return milliseconds (True) or seconds (False).
    
    Returns
    -------
    Union[int, float]
        Current timestamp.
    """
    ts = time.time()
    if milliseconds:
        return int(ts * 1000)
    return ts


def deep_merge(
    base: Dict[str, Any],
    override: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Deep merge two dictionaries.
    
    Parameters
    ----------
    base : Dict[str, Any]
        Base dictionary.
    override : Dict[str, Any]
        Dictionary to merge into base.
    
    Returns
    -------
    Dict[str, Any]
        Merged dictionary.
    
    Examples
    --------
    >>> deep_merge({"a": 1, "b": {"c": 2}}, {"b": {"d": 3}})
    {'a': 1, 'b': {'c': 2, 'd': 3}}
    """
    result = base.copy()
    
    for key, value in override.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    
    return result


def flatten_dict(
    d: Dict[str, Any],
    separator: str = ".",
    prefix: str = "",
) -> Dict[str, Any]:
    """
    Flatten a nested dictionary.
    
    Parameters
    ----------
    d : Dict[str, Any]
        Dictionary to flatten.
    separator : str
        Separator for nested keys.
    prefix : str
        Prefix for keys.
    
    Returns
    -------
    Dict[str, Any]
        Flattened dictionary.
    
    Examples
    --------
    >>> flatten_dict({"a": {"b": 1, "c": 2}})
    {'a.b': 1, 'a.c': 2}
    """
    result: Dict[str, Any] = {}
    
    for key, value in d.items():
        new_key = f"{prefix}{separator}{key}" if prefix else key
        
        if isinstance(value, dict):
            result.update(flatten_dict(value, separator, new_key))
        else:
            result[new_key] = value
    
    return result


def unflatten_dict(
    d: Dict[str, Any],
    separator: str = ".",
) -> Dict[str, Any]:
    """
    Unflatten a dictionary with dot-separated keys.
    
    Parameters
    ----------
    d : Dict[str, Any]
        Flattened dictionary.
    separator : str
        Separator used in keys.
    
    Returns
    -------
    Dict[str, Any]
        Nested dictionary.
    """
    result: Dict[str, Any] = {}
    
    for key, value in d.items():
        parts = key.split(separator)
        current = result
        
        for part in parts[:-1]:
            if part not in current:
                current[part] = {}
            current = current[part]
        
        current[parts[-1]] = value
    
    return result


def chunk_list(
    lst: List[T],
    chunk_size: int,
) -> List[List[T]]:
    """
    Split a list into chunks.
    
    Parameters
    ----------
    lst : List[T]
        List to split.
    chunk_size : int
        Size of each chunk.
    
    Returns
    -------
    List[List[T]]
        List of chunks.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    
    return [lst[i:i + chunk_size] for i in range(0, len(lst), chunk_size)]


def safe_get(
    d: Dict[str, Any],
    *keys: str,
    default: Any = None,
) -> Any:
    """
    Safely get a nested value from a dictionary.
    
    Parameters
    ----------
    d : Dict[str, Any]
        Dictionary to access.
    *keys : str
        Keys to traverse.
    default : Any
        Default value if key path doesn't exist.
    
    Returns
    -------
    Any
        Value at the key path or default.
    
    Examples
    --------
    >>> safe_get({"a": {"b": {"c": 1}}}, "a", "b", "c")
    1
    >>> safe_get({"a": {}}, "a", "b", "c", default=0)
    0
    """
    current = d
    
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
        if current is None:
            return default
    
    return current


def compute_hash(
    data: Union[str, bytes, Dict[str, Any]],
    algorithm: str = "sha256",
) -> str:
    """
    Compute a hash of data.
    
    Parameters
    ----------
    data : Union[str, bytes, Dict[str, Any]]
        Data to hash.
    algorithm : str
        Hash algorithm to use.
    
    Returns
    -------
    str
        Hexadecimal hash string.
    """
    if isinstance(data, dict):
        data = json.dumps(data, sort_keys=True)
    
    if isinstance(data, str):
        data = data.encode("utf-8")
    
    hasher = hashlib.new(algorithm)
    hasher.update(data)
    return hasher.hexdigest()


def truncate_string(
    s: str,
    max_length: int = 100,
    suffix: str = "...",
) -> str:
    """
    Truncate a string to a maximum length.
    
    Parameters
    ----------
    s : str
        String to truncate.
    max_length : int
        Maximum length.
    suffix : str
        Suffix to add when truncated.
    
    Returns
    -------
    str
        Truncated string.
    """
    if len(s) <= max_length:
        return s
    
    return s[:max_length - len(suffix)] + suffix


def sanitize_filename(
    filename: str,
    replacement: str = "_",
) -> str:
    """
    Sanitize a filename by removing invalid characters.
    
    Parameters
    ----------
    filename : str
        Filename to sanitize.
    replacement : str
        Replacement for invalid characters.
    
    Returns
    -------
    str
        Sanitized filename.
    """
    # Remove invalid characters
    invalid_chars = r'<>:"/\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, replacement)
    
    # Remove control characters
    filename = "".join(c for c in filename if ord(c) >= 32)
    
    # Remove leading/trailing dots and spaces
    filename = filename.strip(". ")
    
    return filename or "unnamed"


class RateLimiter:
    """
    Rate limiter for controlling request rates.
    
    Implements a token bucket algorithm for rate limiting.
    
    Attributes
    ----------
    rate : float
        Requests per second allowed.
    capacity : int
        Maximum tokens in the bucket.
    """
    
    def __init__(
        self,
        rate: float = 10.0,
        capacity: Optional[int] = None,
    ) -> None:
        self.rate = rate
        self.capacity = capacity or int(rate * 10)
        self._tokens = self.capacity
        self._last_update = time.time()
        self._lock = asyncio.Lock()
    
    async def acquire(self, tokens: int = 1) -> float:
        """
        Acquire tokens from the bucket.
        
        Parameters
        ----------
        tokens : int
            Number of tokens to acquire.
        
        Returns
        -------
        float
            Time waited in seconds.
        """
        async with self._lock:
            now = time.time()
            elapsed = now - self._last_update
            self._tokens = min(
                self.capacity,
                self._tokens + elapsed * self.rate,
            )
            self._last_update = now
            
            if self._tokens >= tokens:
                self._tokens -= tokens
                return 0.0
            
            # Need to wait
            needed = tokens - self._tokens
            wait_time = needed / self.rate
            
            await asyncio.sleep(wait_time)
            
            self._tokens = 0
            self._last_update = time.time()
            
            return wait_time
    
    @asynccontextmanager
    async def limit(self, tokens: int = 1) -> AsyncGenerator[None, None]:
        """Context manager for rate limiting."""
        await self.acquire(tokens)
        yield


class ExpiringCache(Generic[T]):
    """
    Cache with time-based expiration.
    
    Stores values that automatically expire after a specified duration.
    
    Attributes
    ----------
    ttl : float
        Time to live in seconds.
    max_size : Optional[int]
        Maximum cache size.
    """
    
    def __init__(
        self,
        ttl: float = 300.0,
        max_size: Optional[int] = None,
    ) -> None:
        self.ttl = ttl
        self.max_size = max_size
        self._cache: Dict[str, Tuple[T, float]] = {}
        self._lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[T]:
        """Get a value from the cache."""
        async with self._lock:
            if key not in self._cache:
                return None
            
            value, expiry = self._cache[key]
            
            if time.time() > expiry:
                del self._cache[key]
                return None
            
            return value
    
    async def set(self, key: str, value: T) -> None:
        """Set a value in the cache."""
        async with self._lock:
            if self.max_size and len(self._cache) >= self.max_size:
                # Remove oldest entries
                sorted_keys = sorted(
                    self._cache.keys(),
                    key=lambda k: self._cache[k][1],
                )
                for old_key in sorted_keys[:len(self._cache) - self.max_size + 1]:
                    del self._cache[old_key]
            
            self._cache[key] = (value, time.time() + self.ttl)
    
    async def delete(self, key: str) -> None:
        """Delete a value from the cache."""
        async with self._lock:
            self._cache.pop(key, None)
    
    async def clear(self) -> None:
        """Clear all values from the cache."""
        async with self._lock:
            self._cache.clear()
    
    async def cleanup(self) -> int:
        """Remove expired entries and return count."""
        async with self._lock:
            now = time.time()
            expired = [
                k for k, (_, expiry) in self._cache.items()
                if now > expiry
            ]
            for key in expired:
                del self._cache[key]
            return len(expired)

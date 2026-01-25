"""
Safety and Boundaries for WRAP
"""

from typing import Optional, Dict, Any, List, Set
from dataclasses import dataclass, field
from enum import Enum
import re
from datetime import datetime


class Permission(str, Enum):
    """Permissions for fine-grained access control"""
    FS_READ = "fs.read"
    FS_WRITE = "fs.write"
    FS_DELETE = "fs.delete"
    NETWORK_HTTP = "network.http"
    NETWORK_WEBSOCKET = "network.websocket"
    EXEC_SHELL = "exec.shell"
    EXEC_CODE = "exec.code"
    ENV_READ = "env.read"
    ENV_WRITE = "env.write"


@dataclass
class NetworkBoundaries:
    """Network access boundaries"""
    enabled: bool = False
    allowed_hosts: List[str] = field(default_factory=list)
    denied_hosts: List[str] = field(default_factory=list)
    allowed_ports: List[int] = field(default_factory=list)
    max_request_size: int = 10 * 1024 * 1024
    max_response_size: int = 10 * 1024 * 1024
    request_timeout: int = 30000
    require_https: bool = True


@dataclass
class FilesystemBoundaries:
    """Filesystem access boundaries"""
    enabled: bool = False
    root: str = "/tmp/wrap"
    allowed_paths: List[str] = field(default_factory=list)
    denied_paths: List[str] = field(default_factory=list)
    allow_write: bool = False
    allow_delete: bool = False
    max_file_size: int = 10 * 1024 * 1024
    max_storage: int = 100 * 1024 * 1024


@dataclass
class EnvironmentBoundaries:
    """Environment variable boundaries"""
    enabled: bool = False
    allowed_vars: List[str] = field(default_factory=list)
    denied_vars: List[str] = field(default_factory=list)
    read_only_vars: List[str] = field(default_factory=list)


@dataclass
class PermissionSet:
    """Set of granted and denied permissions"""
    granted: Set[Permission] = field(default_factory=set)
    denied: Set[Permission] = field(default_factory=set)
    conditions: Dict[Permission, Dict[str, Any]] = field(default_factory=dict)
    default_allow: bool = False

    def grant(self, permission: Permission) -> None:
        self.denied.discard(permission)
        self.granted.add(permission)

    def deny(self, permission: Permission) -> None:
        self.granted.discard(permission)
        self.denied.add(permission)

    def check(self, permission: Permission) -> bool:
        if permission in self.denied:
            return False
        if permission in self.granted:
            return True
        return self.default_allow


@dataclass
class RateLimitConfig:
    """Rate limiting configuration"""
    window_ms: int = 60000
    max_requests: int = 100
    key: str = "per_minute"
    strategy: str = "sliding_window"


@dataclass
class CostLimits:
    """Cost limits for API usage"""
    max_input_cost: float = 1.0
    max_output_cost: float = 1.0
    max_total_cost: float = 2.0
    currency: str = "USD"
    alert_thresholds: List[float] = field(default_factory=lambda: [0.5, 0.75, 0.9])


@dataclass
class Boundaries:
    """Complete boundary configuration"""
    timeout: int = 60000
    memory_limit: int = 512 * 1024 * 1024
    cpu_limit: float = 0.5
    max_tool_calls: int = 100
    max_recursion_depth: int = 10
    network: NetworkBoundaries = field(default_factory=NetworkBoundaries)
    filesystem: FilesystemBoundaries = field(default_factory=FilesystemBoundaries)
    environment: EnvironmentBoundaries = field(default_factory=EnvironmentBoundaries)
    permissions: PermissionSet = field(default_factory=PermissionSet)
    rate_limits: List[RateLimitConfig] = field(default_factory=list)
    cost_limits: CostLimits = field(default_factory=CostLimits)


def default_boundaries() -> Boundaries:
    """Create default boundaries configuration"""
    return Boundaries(
        timeout=60000,
        memory_limit=512 * 1024 * 1024,
        cpu_limit=0.5,
        max_tool_calls=100,
        max_recursion_depth=10,
        network=NetworkBoundaries(),
        filesystem=FilesystemBoundaries(),
        environment=EnvironmentBoundaries(),
        permissions=PermissionSet(
            granted={Permission.FS_READ, Permission.NETWORK_HTTP},
            denied=set(),
            default_allow=False
        ),
        rate_limits=[RateLimitConfig()],
        cost_limits=CostLimits()
    )


class SafetyManager:
    """Manager for safety checks and boundaries"""

    def __init__(self, boundaries: Boundaries):
        self.boundaries = boundaries
        self._violation_count = 0
        self._warnings: List[Dict[str, Any]] = []

    def check_permission(self, permission: Permission) -> bool:
        """Check if a permission is allowed"""
        return self.boundaries.permissions.check(permission)

    def check_resource_usage(self, memory: int, cpu: float) -> bool:
        """Check if resource usage is within limits"""
        if memory > self.boundaries.memory_limit:
            self._record_violation("memory", memory, self.boundaries.memory_limit)
            return False
        if cpu > self.boundaries.cpu_limit:
            self._record_violation("cpu", cpu, self.boundaries.cpu_limit)
            return False
        return True

    def check_network_host(self, host: str) -> bool:
        """Check if a network host is allowed"""
        if not self.boundaries.network.enabled:
            return False
        if host in self.boundaries.network.denied_hosts:
            return False
        if "*" in self.boundaries.network.allowed_hosts:
            return True
        return host in self.boundaries.network.allowed_hosts

    def check_file_path(self, path: str) -> bool:
        """Check if a file path is allowed"""
        if not self.boundaries.filesystem.enabled:
            return False
        for denied in self.boundaries.filesystem.denied_paths:
            if path.startswith(denied):
                return False
        if not self.boundaries.filesystem.allowed_paths:
            return True
        for allowed in self.boundaries.filesystem.allowed_paths:
            if path.startswith(allowed):
                return True
        return False

    def filter_content(self, content: str) -> tuple[bool, Optional[str]]:
        """Filter content for safety issues"""
        # Check for PII patterns
        pii_patterns = [
            (r'\b[\w\.-]+@[\w\.-]+\.\w+\b', 'email'),
            (r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', 'phone'),
            (r'\b\d{3}-\d{2}-\d{4}\b', 'ssn'),
            (r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', 'credit_card'),
        ]

        for pattern, pii_type in pii_patterns:
            if re.search(pattern, content):
                return False, f"PII detected: {pii_type}"

        return True, None

    def _record_violation(self, resource: str, used: Any, limit: Any) -> None:
        """Record a boundary violation"""
        self._violation_count += 1
        self._warnings.append({
            "type": "boundary_violation",
            "resource": resource,
            "used": used,
            "limit": limit,
            "timestamp": datetime.utcnow().isoformat()
        })

    @property
    def violation_count(self) -> int:
        return self._violation_count

    def get_warnings(self) -> List[Dict[str, Any]]:
        return list(self._warnings)

    def clear_warnings(self) -> None:
        self._warnings.clear()

"""
Audit logging for compliance and debugging
"""

import asyncio
import json
import os
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
import uuid


class AuditEventType(str, Enum):
    EXECUTION_START = "execution_start"
    EXECUTION_END = "execution_end"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    PERMISSION_CHECK = "permission_check"
    PERMISSION_GRANTED = "permission_granted"
    PERMISSION_DENIED = "permission_denied"
    BOUNDARY_VIOLATION = "boundary_violation"
    RATE_LIMIT_HIT = "rate_limit_hit"
    ERROR = "error"
    SANDBOX_CREATED = "sandbox_created"
    SANDBOX_DESTROYED = "sandbox_destroyed"


@dataclass
class AuditEvent:
    """An audit event"""
    id: str
    type: AuditEventType
    timestamp: datetime
    data: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "timestamp": self.timestamp.isoformat(),
            "data": self.data,
            "metadata": self.metadata
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict())


class AuditLog:
    """Audit log for recording events"""

    def __init__(
        self,
        path: Optional[str] = None,
        max_entries: int = 10000,
        flush_interval: int = 100
    ):
        self._path = path
        self._max_entries = max_entries
        self._flush_interval = flush_interval
        self._entries: List[AuditEvent] = []
        self._pending_flush = False
        self._callbacks: List[Callable] = []
        self._created_at = datetime.utcnow()

    async def log(self, event_type: AuditEventType, data: Optional[Dict[str, Any]] = None, metadata: Optional[Dict[str, Any]] = None) -> str:
        """Log an audit event"""
        event = AuditEvent(
            id=str(uuid.uuid4()),
            type=event_type,
            timestamp=datetime.utcnow(),
            data=data or {},
            metadata=metadata or {}
        )

        self._entries.append(event)

        if len(self._entries) > self._max_entries:
            self._entries = self._entries[-self._max_entries:]

        for callback in self._callbacks:
            try:
                result = callback(event)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass

        if self._path and len(self._entries) % self._flush_interval == 0:
            await self._flush()

        return event.id

    async def log_execution_start(self, execution_id: str, agent_id: str, prompt: str) -> str:
        return await self.log(
            AuditEventType.EXECUTION_START,
            {"execution_id": execution_id, "agent_id": agent_id, "prompt": prompt[:500]}
        )

    async def log_execution_end(self, execution_id: str, success: bool, duration_ms: int, tokens: int) -> str:
        return await self.log(
            AuditEventType.EXECUTION_END,
            {"execution_id": execution_id, "success": success, "duration_ms": duration_ms, "tokens": tokens}
        )

    async def log_tool_call(self, tool_name: str, input_data: Dict[str, Any], execution_id: str) -> str:
        return await self.log(
            AuditEventType.TOOL_CALL,
            {"tool_name": tool_name, "input": input_data, "execution_id": execution_id}
        )

    async def log_tool_result(self, tool_name: str, output: Any, duration_ms: int) -> str:
        return await self.log(
            AuditEventType.TOOL_RESULT,
            {"tool_name": tool_name, "output": str(output)[:1000], "duration_ms": duration_ms}
        )

    async def log_permission_check(self, permission: str, allowed: bool, context: str) -> str:
        return await self.log(
            AuditEventType.PERMISSION_CHECK,
            {"permission": permission, "allowed": allowed, "context": context}
        )

    async def log_boundary_violation(self, boundary: str, details: Dict[str, Any]) -> str:
        return await self.log(
            AuditEventType.BOUNDARY_VIOLATION,
            {"boundary": boundary, **details}
        )

    async def log_error(self, error_code: str, message: str, context: Optional[Dict[str, Any]] = None) -> str:
        return await self.log(
            AuditEventType.ERROR,
            {"error_code": error_code, "message": message, **(context or {})}
        )

    async def get_entries(self, limit: int = 100, event_type: Optional[AuditEventType] = None) -> List[AuditEvent]:
        """Get recent entries"""
        entries = self._entries
        if event_type:
            entries = [e for e in entries if e.type == event_type]
        return entries[-limit:]

    async def search(self, query: Dict[str, Any]) -> List[AuditEvent]:
        """Search for entries matching query"""
        results = []
        for entry in self._entries:
            match = True
            for key, value in query.items():
                if key in entry.data:
                    if entry.data[key] != value:
                        match = False
                        break
                elif key in entry.metadata:
                    if entry.metadata[key] != value:
                        match = False
                        break
                else:
                    match = False
                    break
            if match:
                results.append(entry)
        return results

    async def clear(self) -> None:
        """Clear all entries"""
        self._entries = []

    async def export(self, path: str) -> None:
        """Export log to file"""
        data = [entry.to_dict() for entry in self._entries]
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)

    async def _flush(self) -> None:
        """Flush to persistent storage"""
        if not self._path or self._pending_flush:
            return

        self._pending_flush = True
        try:
            data = [entry.to_dict() for entry in self._entries]
            temp_path = f"{self._path}.tmp"
            with open(temp_path, 'w') as f:
                json.dump(data, f)
            os.replace(temp_path, self._path)
        finally:
            self._pending_flush = False

    def on_event(self, callback: Callable) -> None:
        """Register a callback for new events"""
        self._callbacks.append(callback)

    def stats(self) -> Dict[str, Any]:
        """Get audit log statistics"""
        type_counts = {}
        for entry in self._entries:
            type_name = entry.type.value
            type_counts[type_name] = type_counts.get(type_name, 0) + 1

        return {
            "total_entries": len(self._entries),
            "max_entries": self._max_entries,
            "created_at": self._created_at.isoformat(),
            "type_counts": type_counts,
            "path": self._path
        }

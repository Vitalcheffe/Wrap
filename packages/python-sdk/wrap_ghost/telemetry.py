"""
Telemetry and observability for WRAP
"""

import asyncio
import time
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import uuid


class SpanKind(str, Enum):
    INTERNAL = "internal"
    SERVER = "server"
    CLIENT = "client"
    PRODUCER = "producer"
    CONSUMER = "consumer"


class MetricType(str, Enum):
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"


@dataclass
class Span:
    """OpenTelemetry span"""
    id: str
    trace_id: str
    parent_span_id: Optional[str]
    name: str
    kind: SpanKind
    start_time: datetime
    end_time: Optional[datetime] = None
    attributes: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict[str, Any]] = field(default_factory=list)
    status: Dict[str, Any] = field(default_factory=lambda: {"code": 0})


@dataclass
class Metric:
    """A metric data point"""
    name: str
    type: MetricType
    value: float
    timestamp: datetime
    attributes: Dict[str, Any] = field(default_factory=dict)
    unit: Optional[str] = None


@dataclass
class LogEntry:
    """A log entry"""
    timestamp: datetime
    level: str
    message: str
    attributes: Dict[str, Any] = field(default_factory=dict)
    span_id: Optional[str] = None
    trace_id: Optional[str] = None


class Tracer:
    """Distributed tracing"""

    def __init__(self, name: str = "wrap"):
        self._name = name
        self._spans: Dict[str, Span] = {}
        self._current_span: Optional[str] = None

    def start_span(
        self,
        name: str,
        kind: SpanKind = SpanKind.INTERNAL,
        parent: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None
    ) -> Span:
        """Start a new span"""
        span_id = str(uuid.uuid4())[:16]
        trace_id = parent.split('-')[0] if parent else str(uuid.uuid4())[:32]
        parent_id = parent.split('-')[1] if parent and '-' in parent else None

        span = Span(
            id=span_id,
            trace_id=trace_id,
            parent_span_id=parent_id,
            name=name,
            kind=kind,
            start_time=datetime.utcnow(),
            attributes=attributes or {}
        )

        self._spans[span_id] = span
        self._current_span = span_id
        return span

    def end_span(self, span_id: str, status_code: int = 0, status_message: Optional[str] = None) -> None:
        """End a span"""
        if span_id in self._spans:
            span = self._spans[span_id]
            span.end_time = datetime.utcnow()
            span.status = {"code": status_code, "message": status_message}

    def add_event(self, span_id: str, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Add an event to a span"""
        if span_id in self._spans:
            self._spans[span_id].events.append({
                "name": name,
                "timestamp": datetime.utcnow().isoformat(),
                "attributes": attributes or {}
            })

    def set_attribute(self, span_id: str, key: str, value: Any) -> None:
        """Set an attribute on a span"""
        if span_id in self._spans:
            self._spans[span_id].attributes[key] = value

    def get_span(self, span_id: str) -> Optional[Span]:
        """Get a span by ID"""
        return self._spans.get(span_id)

    def get_trace(self, trace_id: str) -> List[Span]:
        """Get all spans in a trace"""
        return [s for s in self._spans.values() if s.trace_id == trace_id]


class MetricsCollector:
    """Metrics collection"""

    def __init__(self):
        self._counters: Dict[str, float] = {}
        self._gauges: Dict[str, float] = {}
        self._histograms: Dict[str, List[float]] = {}
        self._attributes: Dict[str, Dict[str, Any]] = {}

    def counter(self, name: str, value: float = 1.0, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Increment a counter"""
        key = self._make_key(name, attributes)
        self._counters[key] = self._counters.get(key, 0) + value
        self._attributes[key] = attributes or {}

    def gauge(self, name: str, value: float, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Set a gauge value"""
        key = self._make_key(name, attributes)
        self._gauges[key] = value
        self._attributes[key] = attributes or {}

    def histogram(self, name: str, value: float, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Record a histogram value"""
        key = self._make_key(name, attributes)
        if key not in self._histograms:
            self._histograms[key] = []
        self._histograms[key].append(value)
        self._attributes[key] = attributes or {}

    def _make_key(self, name: str, attributes: Optional[Dict[str, Any]]) -> str:
        if not attributes:
            return name
        attr_str = ','.join(f"{k}={v}" for k, v in sorted(attributes.items()))
        return f"{name}{attr_str}"

    def get_all(self) -> Dict[str, Any]:
        """Get all metrics"""
        return {
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
            "histograms": {k: {"values": v, "count": len(v), "sum": sum(v), "avg": sum(v) / len(v) if v else 0}
                         for k, v in self._histograms.items()}
        }

    def reset(self) -> None:
        """Reset all metrics"""
        self._counters.clear()
        self._gauges.clear()
        self._histograms.clear()


class Telemetry:
    """Telemetry manager"""

    def __init__(self, service_name: str = "wrap"):
        self.service_name = service_name
        self.tracer = Tracer(service_name)
        self.metrics = MetricsCollector()
        self._logs: List[LogEntry] = []
        self._max_logs = 10000

    def log(self, level: str, message: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Add a log entry"""
        entry = LogEntry(
            timestamp=datetime.utcnow(),
            level=level,
            message=message,
            attributes=attributes or {},
            span_id=self.tracer._current_span
        )
        self._logs.append(entry)
        if len(self._logs) > self._max_logs:
            self._logs = self._logs[-self._max_logs:]

    def get_logs(self, limit: int = 100, level: Optional[str] = None) -> List[LogEntry]:
        """Get recent logs"""
        logs = self._logs
        if level:
            logs = [l for l in logs if l.level == level]
        return logs[-limit:]

    def export(self) -> Dict[str, Any]:
        """Export telemetry data"""
        return {
            "service_name": self.service_name,
            "spans": len(self.tracer._spans),
            "metrics": self.metrics.get_all(),
            "logs": len(self._logs),
            "exported_at": datetime.utcnow().isoformat()
        }

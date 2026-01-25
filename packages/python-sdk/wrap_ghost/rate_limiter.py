"""
Rate limiting implementation for WRAP
"""

import asyncio
import time
from typing import Dict, Optional, Callable, Any
from dataclasses import dataclass, field
from datetime import datetime
from collections import defaultdict


@dataclass
class RateLimitConfig:
    """Configuration for a rate limit"""
    name: str
    max_requests: int
    window_seconds: float
    strategy: str = "sliding_window"


@dataclass
class RateLimitState:
    """State for rate limiting"""
    requests: list = field(default_factory=list)
    token_bucket: float = 0.0
    last_refill: float = field(default_factory=time.time)


class RateLimiter:
    """Rate limiter with multiple strategies"""

    def __init__(self, configs: Optional[list] = None):
        self._configs: Dict[str, RateLimitConfig] = {}
        self._states: Dict[str, Dict[str, RateLimitState]] = defaultdict(lambda: defaultdict(RateLimitState))
        self._callbacks: Dict[str, list] = defaultdict(list)

        if configs:
            for config in configs:
                if isinstance(config, dict):
                    self.add_config(RateLimitConfig(**config))
                else:
                    self.add_config(config)

    def add_config(self, config: RateLimitConfig) -> None:
        self._configs[config.name] = config

    def check(self, key: str, config_name: Optional[str] = None) -> bool:
        if config_name:
            config = self._configs.get(config_name)
            if not config:
                return True
            return self._check_limit(key, config)

        for config in self._configs.values():
            if not self._check_limit(key, config):
                return False
        return True

    def _check_limit(self, key: str, config: RateLimitConfig) -> bool:
        state = self._states[config.name][key]
        now = time.time()

        if config.strategy == "sliding_window":
            return self._check_sliding_window(state, config, now)
        elif config.strategy == "fixed_window":
            return self._check_fixed_window(state, config, now)
        elif config.strategy == "token_bucket":
            return self._check_token_bucket(state, config, now)
        elif config.strategy == "leaky_bucket":
            return self._check_leaky_bucket(state, config, now)

        return True

    def _check_sliding_window(self, state: RateLimitState, config: RateLimitConfig, now: float) -> bool:
        window_start = now - config.window_seconds
        state.requests = [t for t in state.requests if t >= window_start]
        return len(state.requests) < config.max_requests

    def _check_fixed_window(self, state: RateLimitState, config: RateLimitConfig, now: float) -> bool:
        window_start = now - (now % config.window_seconds)
        if not state.requests or state.requests[0] < window_start:
            state.requests = []
        return len(state.requests) < config.max_requests

    def _check_token_bucket(self, state: RateLimitState, config: RateLimitConfig, now: float) -> bool:
        elapsed = now - state.last_refill
        refill_rate = config.max_requests / config.window_seconds
        state.token_bucket = min(config.max_requests, state.token_bucket + elapsed * refill_rate)
        state.last_refill = now
        return state.token_bucket >= 1.0

    def _check_leaky_bucket(self, state: RateLimitState, config: RateLimitConfig, now: float) -> bool:
        leak_rate = config.max_requests / config.window_seconds
        elapsed = now - (state.requests[-1] if state.requests else 0)
        leaked = int(elapsed * leak_rate)
        state.requests = state.requests[leaked:]
        return len(state.requests) < config.max_requests

    def record(self, key: str, config_name: Optional[str] = None) -> None:
        now = time.time()

        if config_name:
            config = self._configs.get(config_name)
            if config:
                self._record_request(key, config, now)
        else:
            for config in self._configs.values():
                self._record_request(key, config, now)

    def _record_request(self, key: str, config: RateLimitConfig, now: float) -> None:
        state = self._states[config.name][key]

        if config.strategy == "token_bucket":
            state.token_bucket -= 1.0
        else:
            state.requests.append(now)

    def remaining(self, key: str, config_name: str) -> int:
        config = self._configs.get(config_name)
        if not config:
            return 0

        state = self._states[config.name][key]
        now = time.time()

        if config.strategy == "token_bucket":
            return int(state.token_bucket)
        else:
            window_start = now - config.window_seconds
            current = len([t for t in state.requests if t >= window_start])
            return max(0, config.max_requests - current)

    def reset(self, key: str, config_name: Optional[str] = None) -> None:
        if config_name:
            self._states[config_name].pop(key, None)
        else:
            for name in self._configs:
                self._states[name].pop(key, None)

    def on_limit_exceeded(self, config_name: str, callback: Callable) -> None:
        self._callbacks[config_name].append(callback)

    def get_stats(self) -> Dict[str, Any]:
        stats = {}
        for name, config in self._configs.items():
            total_requests = sum(len(state.requests) for state in self._states[name].values())
            stats[name] = {
                "config": {
                    "max_requests": config.max_requests,
                    "window_seconds": config.window_seconds,
                    "strategy": config.strategy
                },
                "total_requests": total_requests,
                "active_keys": len(self._states[name])
            }
        return stats

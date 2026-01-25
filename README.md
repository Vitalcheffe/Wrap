# WRAP - Protocol NEBULA
## Universal AI Agent Runtime with Zero Trust Sandbox

<p align="center">
  <img src="https://img.shields.io/badge/WRAP-NEBULA-000000?style=for-the-badge" alt="WRAP"/>
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge" alt="Version"/>
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License"/>
  <img src="https://img.shields.io/badge/lines-37%2C619-orange?style=for-the-badge" alt="Lines"/>
</p>

```
WRAP = Context + Tools + Boundaries + Output
```

**Run anything, anywhere, locally, with zero trust.**

---

## 🚀 Quick Start

### Python (2 lines)

```python
from wrap_ghost import WRAP
result = await WRAP().execute("Your prompt here")
```

### JavaScript/TypeScript (2 lines)

```typescript
import { WRAP } from '@wrap/js-sdk';
const result = await (await WRAP.create()).execute('Your prompt here');
```

---

## 📦 Project Structure (37,619 lines)

```
WRAP-NEBULA-QUANTUM-v1.0.0/
├── packages/
│   ├── core/              # @wrap/core (10,290 lines)
│   │   └── src/
│   │       ├── types.ts         # Complete type definitions
│   │       ├── sandbox/         # Sandbox implementation
│   │       ├── agent/           # Agent execution engine
│   │       └── tools/           # Built-in tools
│   │
│   ├── python-sdk/        # wrap_ghost (5,153 lines)
│   │   └── wrap_ghost/
│   │       ├── __init__.py      # Main exports
│   │       ├── client.py        # WRAP client
│   │       ├── sandbox.py       # Sandbox management
│   │       ├── agent.py         # Agent creation
│   │       ├── tools.py         # Tool implementations
│   │       ├── safety.py        # Safety boundaries
│   │       ├── telemetry.py     # OpenTelemetry
│   │       ├── rate_limiter.py  # Rate limiting
│   │       └── audit.py         # Audit logging
│   │
│   └── js-sdk/            # @wrap/js-sdk (12,313 lines)
│       └── src/
│           ├── index.ts         # Main exports
│           └── types.ts         # TypeScript types
│
├── crates/
│   └── governor/          # Rust Safety Governor (9,863 lines)
│       └── src/
│           ├── lib.rs           # Main library
│           ├── permissions.rs   # Permission system
│           ├── boundaries.rs    # Resource limits
│           └── filters.rs       # Content filtering
│
└── README.md
```

---

## 🔐 Zero Trust Security

### Permission System

```python
from wrap_ghost import Boundaries, Permission

boundaries = Boundaries(
    timeout=60000,
    memory_limit=512 * 1024 * 1024,
    permissions={
        "granted": [Permission.FS_READ, Permission.NETWORK_HTTP],
        "denied": []
    }
)
```

### Content Filtering

- **Profanity Detection** - Block inappropriate content
- **PII Detection** - Redact emails, phones, SSNs, credit cards
- **Injection Prevention** - SQL, XSS, command, prompt injection

### Resource Limits

- Memory limits (bytes)
- CPU limits (percentage)
- Timeout enforcement (ms)
- Max tool calls
- Rate limiting

---

## 🛠️ Built-in Tools

| Tool | Description | Destructive |
|------|-------------|-------------|
| `FileTool` | Read/write/delete files | Yes |
| `ShellTool` | Execute shell commands | Yes |
| `WebTool` | HTTP requests | No |
| `CodeTool` | Execute Python/JS | Yes |
| `MemoryTool` | Key-value storage | No |

---

## 📊 Comparison

| Feature | WRAP | OpenAI Agents | LangChain |
|---------|------|---------------|-----------|
| Zero Trust Security | ✅ | ❌ | ❌ |
| Rust Governor | ✅ | ❌ | ❌ |
| Python SDK | ✅ | ✅ | ✅ |
| JavaScript SDK | ✅ | ✅ | ✅ |
| Content Filtering | ✅ | ❌ | ❌ |
| Audit Logging | ✅ | ❌ | ❌ |
| Rate Limiting | ✅ | ❌ | ❌ |

---

## 🔧 Installation

### Python SDK

```bash
cd packages/python-sdk
pip install -e .
```

### JavaScript SDK

```bash
cd packages/js-sdk
npm install
npm run build
```

### Rust Governor

```bash
cd crates/governor
cargo build --release
```

---

## 📖 API Reference

### Create a Sandbox

```python
from wrap_ghost import Sandbox, SandboxConfig

sandbox = await Sandbox.create(SandboxConfig(
    type="v8",
    timeout=60000
))
result = await sandbox.execute_code("print('hello')")
await sandbox.stop()
```

### Create an Agent

```python
from wrap_ghost import Agent, AgentConfig
from wrap_ghost.tools import FileTool, ShellTool

agent = Agent(AgentConfig(
    model="gpt-4",
    tools=[FileTool(), ShellTool()],
    max_iterations=10
))
result = await agent.run("List all Python files")
```

### Use the Rust Governor

```rust
use wrap_governor::{Governor, GovernorConfig, Permission};

let governor = Governor::new(GovernorConfig::default())?;
governor.grant_permission(Permission::FileRead("/tmp/data.txt".to_string())).await?;
let allowed = governor.check_permission(Permission::FileRead("/tmp/data.txt")).await?;
```

---

## 🧪 Testing

```bash
# Python tests
cd packages/python-sdk
pytest tests/

# JavaScript tests
cd packages/js-sdk
npm test

# Rust tests
cd crates/governor
cargo test
```

---

## 📄 License

MIT License

---

<p align="center">
  <strong>WRAP = Context + Tools + Boundaries + Output</strong>
</p>

<p align="center">
  Made with ❤️ by the WRAP Team
</p>

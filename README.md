# WRAP NEBULA 🌌

**Your personal AI. Free. Secure. Zero Trust.**

> Run anything, anywhere, locally — with a security layer no other open-source framework has.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange.svg)](https://www.rust-lang.org/)
[![Tests](https://img.shields.io/badge/Tests-29%2F29-brightgreen.svg)](#testing)
[![Zero Trust](https://img.shields.io/badge/Security-Zero%20Trust%20Verified-red.svg)](#security)

---

Telegram / Discord / Web · Any model · Any OS · Beginner friendly

```
Your message (Telegram, Discord, Web)
          │
          ▼
  ┌───────────────────────────────┐
  │     WRAP NEBULA Gateway       │
  │     (control plane)           │
  │     http://127.0.0.1:3777     │
  └──────────────┬────────────────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  nebula CLI   Skills     War Room
  (nebula …)   Engine     Dashboard
```

**The only personal AI framework where every skill is cryptographically verified before it runs.**

---

## What is WRAP NEBULA?

WRAP NEBULA is a personal AI assistant you run on your own machine. It answers you on the channels you already use (Telegram, Discord, Web), executes skills safely inside a Rust-powered sandbox, and keeps a signed audit trail of everything it does.

No cloud. No subscription. No data leaving your machine without your permission.

- **Beginners** → run `nebula init`, answer 5 questions, talk to your agent on Telegram
- **Developers** → write skills in TypeScript, extend the Core, contribute to WrapHub
- **Security researchers** → audit the Rust Governor, verify the Ed25519 audit chain

---

## Quickstart — 3 commands

```bash
# 1. Install
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash

# 2. Setup (interactive wizard — no code required)
nebula init

# 3. Start
nebula start
```

That's it. Your agent is live on Telegram.

---

## Features

### Channels
```
Telegram · Discord · Web UI (War Room)
                                        ← more coming in v8
```

### Security — Zero Trust Architecture
```
User Input
    │
    ▼
InputSanitizer ── detects prompt injection BEFORE the LLM call
    │
    ▼
Core Engine (TypeScript)
    │
    ▼
Rust Safety Governor ── validates EVERY action, EVERY tool call
    ├── PermissionSystem   capability-based, zero permissions by default
    ├── InjectionFilter    prompt injection · SQL · XSS
    ├── SandboxExecutor    V8 isolate — no native fs bindings
    └── AuditTrail         Ed25519 hash chain — cryptographically immutable
    │
    ▼
Policy Engine (YAML, hot-reload) ── compliance layer, separate from security
    ├── PII redaction      SSN · credit cards · emails · phones
    └── Content policy     configurable wordlists, domain allow/deny
```

### Skills (built-in)
```
web.search      Search the web and return a summary
files.read      Read local files (VFS path jail — no escape possible)
files.write     Create and edit files
files.list      List directory contents
code.run        Execute code in an isolated V8 sandbox
reminder.set    Create reminders
reminder.list   List active reminders
git.status      Check Git repository status
calendar.read   🔜 Coming soon
email.summary   🔜 Coming soon
```

### Memory
The agent remembers context across sessions. Tell it your appointment on Monday, ask again on Friday — it knows.

```typescript
// Automatic — no config needed
// Stored locally in SQLite, never sent anywhere
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        WRAP NEBULA v7                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Python SDK  │  │   JS SDK    │  │     CLI     │             │
│  │ thin client │  │ thin client │  │ nebula init │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         └────────────────┼────────────────┘                     │
│                          │  HTTP / WebSocket                     │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Core Engine (TypeScript)                  │  │
│  │  AgentRuntime · ToolsManager · VFS · SecretsManager       │  │
│  │  CircuitBreaker · MCP 2.0 · Telemetry · StateManager      │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │  gRPC                             │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Rust Safety Governor                          │  │
│  │  Permissions · InjectionFilter · Sandbox · AuditTrail     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         Policy Engine (YAML · hot-reload)                  │  │
│  │         PII · Content · Domain rules                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Your SOUL.md — define your agent in plain text

No Python. No config files. Just markdown.

```markdown
# My NEBULA Agent

Name: Aria
Personality: Curious and direct assistant
Language: English

Skills enabled:
- web.search
- files.read
- reminder.set

Rules:
- Never share my API keys
- Ask before deleting files
- Keep answers concise
```

Save as `SOUL.md`, run `nebula start`. Done.

---

## WRAP NEBULA vs other frameworks

| Feature | WRAP NEBULA | OpenClaw | AutoGPT | LangChain |
|---|---|---|---|---|
| Zero Trust security | ✅ Rust Governor | ❌ | ❌ | ❌ |
| Cryptographic audit trail | ✅ Ed25519 | ❌ | ❌ | ❌ |
| Skill sandbox (V8 isolate) | ✅ | ❌ | ❌ | ❌ |
| PII auto-redaction | ✅ | ❌ | ❌ | ❌ |
| SOUL.md config-first | ✅ | ✅ | ❌ | ❌ |
| No-code setup | ✅ wizard | ✅ onboard | ❌ | ❌ |
| Telegram built-in | ✅ | ✅ | ❌ | ❌ |
| Works with Ollama (free) | ✅ | ✅ | ✅ | ✅ |
| MCP 2.0 support | ✅ | ✅ | ❌ | ❌ |
| Beginner friendly | ✅ | ✅ | ❌ | ❌ |
| Open source (MIT) | ✅ | ✅ | ✅ | ✅ |
| Skills verified before run | ✅ | ❌ (41% compromised*) | ❌ | ❌ |

*Security audits found that up to 41% of community skills in similar registries contained vulnerabilities. NEBULA's Rust Governor blocks malicious skills by design — they cannot execute, even if installed.

---

## Supported models

Works with any provider. Switch by editing one line in `SOUL.md`.

```
Claude (Anthropic)     → recommended — best reasoning
GPT-4 (OpenAI)         → strong alternative
Llama 3 (Ollama)       → 100% free, runs locally, no API key needed
Mistral, Qwen, Gemma   → via Ollama
```

**No API key?** Use Ollama — completely free, runs on your machine, zero external calls.

```bash
# Install Ollama (free)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3

# Tell NEBULA to use it
# In your SOUL.md:
# Model: ollama/llama3
```

---

## Project structure

```
wrap-nebula/
├── install.sh                    # One-line installer
├── SOUL.md                       # Your agent definition
├── packages/
│   ├── core/                     # TypeScript Core Engine
│   │   ├── agent/                # Runtime, providers, circuit breaker
│   │   ├── skills/               # Built-in skills (10 available)
│   │   ├── memory/               # Cross-session memory (SQLite)
│   │   ├── vfs/                  # Virtual filesystem with path jail
│   │   ├── secrets/              # Vault / env / encrypted file
│   │   ├── mcp/                  # MCP 2.0 protocol
│   │   └── server.ts             # HTTP + WebSocket server
│   ├── cli/                      # nebula init · start · stop · status
│   ├── channels/
│   │   └── telegram/             # Telegram bot (polling)
│   ├── python-sdk/               # Python thin client
│   └── js-sdk/                   # TypeScript thin client
├── crates/
│   └── governor/                 # Rust Safety Governor
│       ├── permissions.rs        # Capability-based access control
│       ├── sandbox.rs            # V8 isolate execution
│       ├── audit.rs              # Ed25519 hash chain
│       └── filters.rs            # Injection detection
├── apps/
│   └── war-room/                 # Next.js monitoring dashboard
├── policy/
│   └── default.yaml              # PII + content rules (hot-reload)
└── tests/
    ├── integration/              # SDK → Core tests
    └── e2e/                      # End-to-end workflow tests
```

---

## Testing

```bash
# Install dependencies
npm install
pip install httpx pytest pytest-asyncio

# TypeScript — 0 errors
cd packages/core && npx tsc --noEmit

# Python tests — 29/29
python -m pytest tests/ -o "addopts=" -v

# Rust Governor
cd crates/governor && cargo build --release && cargo test
```

**Current status**: 29/29 tests passing · 0 TypeScript errors · 19,655 lines

---

## Roadmap

```
v7 (now)    ✅  Zero Trust core · Telegram · 10 skills · Memory · One-line install
v8          🔜  Discord · WrapHub skill registry · 30+ skills · Docker image
v9          🔜  WhatsApp · Voice input · Mobile companion app
v10         🔜  Multi-agent workflows · Agent-to-agent communication
```

Want a feature? [Open an issue →](https://github.com/Vitalcheffe/Wrap/issues)

---

## Contributing

WRAP NEBULA is MIT — free to use, modify, and build on.

```bash
git clone https://github.com/Vitalcheffe/Wrap.git
cd Wrap
npm install
nebula dev   # starts everything: Governor + Core + Dashboard
```

**Writing a skill** — create a file in `packages/core/src/skills/definitions/`:

```typescript
// packages/core/src/skills/definitions/my.skill.ts
export const mySkill: SkillDefinition = {
  name: 'my.skill',
  description: 'What this skill does',
  permissions: ['network.http'],   // declared upfront — Governor enforces this
  safe: true,
  handler: async (params, context) => {
    // your logic here
    return { result: '...' }
  }
}
```

Every skill declares its permissions upfront. The Rust Governor enforces them. A skill that tries to access the filesystem without declaring `filesystem.read` is blocked — not warned, blocked.

---

## Security policy

Found a vulnerability? Please do not open a public issue.  
Email: security@[your-domain] or open a [private advisory →](https://github.com/Vitalcheffe/Wrap/security/advisories/new)

---

## License

MIT — Use freely, modify openly, share generously.

---

*WRAP NEBULA — Your AI. Your machine. Your rules.* 🌌
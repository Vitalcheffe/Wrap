# WRAP NEBULA

<p align="center">
  <b>The AI agent you can actually verify.</b><br>
  <i>Local-first. Zero-trust. Auditable by design.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Rust-Governor-da5a2a?logo=rust" />
  <img src="https://img.shields.io/badge/TypeScript-Agent-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Sandbox-V8%20Isolate-green" />
  <img src="https://img.shields.io/badge/Audit-Ed25519-purple" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" />
</p>

---

Every AI coding agent sends your code to the cloud. No sandbox. No audit trail. No cryptographic guarantees. You are trusting strangers with your proprietary code.

WRAP NEBULA does the opposite.

---

## The Problem

Kilo Code raised $8M. Cline has 5M installs. Cursor is worth $9B. They all do the same thing: send your code to a server you don't control.

WRAP NEBULA is local-first. Your code never leaves your machine. Every action is signed, sandboxed, and auditable.

---

## What Makes It Different

| | Kilo | Cline | Cursor | **WRAP** |
|---|---|---|---|---|
| Sandbox | no | no | no | **V8 isolate** |
| Audit trail | no | no | no | **Ed25519** |
| PII redaction | no | no | no | **Automatic** |
| Local-first | partial | partial | no | **Default** |
| Free forever | no | no | no | **Yes** |
| Telegram | no | no | no | **Built-in** |

---

## How It Works

Every message flows through a pipeline where compromising one layer does not compromise the others:

1. **Input** — Telegram, CLI, VS Code
2. **Sanitizer** — blocks injection, redacts PII
3. **Rust Governor** — separate process, policy enforcement
4. **SOUL.md** — agent personality in markdown
5. **LLM** — Ollama / Claude / GPT-4
6. **Skills** — sandboxed executors
7. **Memory** — SQLite, local only
8. **Response** — signed, auditable

---

## Quick Start

```bash
# Authenticate
nebula auth login anthropic

# Install
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash

# Start (Ollama must be running)
ollama serve && ollama pull llama3 && nebula start
```

---

## Skills

14 sandboxed executors — each runs in a V8 isolate with no filesystem or network access unless explicitly granted:

- web.search — DuckDuckGo scraping, no API key
- code.execute — sandboxed Python/JS/TS
- file.read/write — scoped to workspace
- system.info — CPU, memory, disk
- ...and more

---

## License

MIT — free forever.

<p align="center">
  <img src="docs/media/banner-black.PNG" alt="WRAP NEBULA" width="600">
</p>

# WRAP NEBULA

The AI agent you can actually verify.

Local-first. Zero-trust. Auditable by design.

---

## The problem

Every AI coding agent sends your code to the cloud. No sandbox. No audit trail. No cryptographic guarantees. You are trusting strangers with your proprietary code.

Kilo Code raised $8M. Cline has 5M installs. Cursor is worth $9B. They all do the same thing: send your code to a server you don't control.

WRAP NEBULA does the opposite.

## What makes it different

| | Kilo | Cline | Cursor | **WRAP** |
|---|---|---|---|---|
| Sandbox | no | no | no | **V8 isolate** |
| Audit trail | no | no | no | **Ed25519** |
| PII redaction | no | no | no | **Automatic** |
| Local-first | partial | partial | no | **Default** |
| Free forever | no | no | no | **Yes** |
| Telegram | no | no | no | **Built-in** |

## Install

```
# Authenticate
nebula auth login anthropic

# Install
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash

# Start (Ollama must be running)
ollama serve && ollama pull llama3 && nebula start
```

## How it works

Every message flows through a pipeline where compromising one layer does not compromise the others:

1. Input — Telegram, CLI, VS Code
2. Sanitizer — blocks injection, redacts PII
3. Rust Governor — separate process, policy enforcement
4. SOUL.md — agent personality in markdown
5. LLM — Ollama / Claude / GPT-4
6. Skills — 14 sandboxed executors
7. Memory — SQLite, local only
8. Response — signed, audited

## Skills

- web.search — DuckDuckGo scraping, no API key
- files.read/write/list — path-restricted filesystem
- code.run — V8 sandboxed execution
- code.edit — diff-based editing with backup
- code.search — grep, find, symbol search
- terminal.run — shell with safety checks
- reminder.set/list — natural language dates
- git.status — structured git output
- calendar.read — local .ics reader
- email.summary — local .mbox reader
- project.context — smart file inclusion

## CLI

- nebula init — setup wizard
- nebula start — start the agent
- nebula stop — stop the agent
- nebula status — show status
- nebula doctor — health check
- nebula auth login — authenticate
- nebula auth list — show credentials
- nebula skill create — create a skill

## Security

Input Sanitizer: 10 prompt injection, 6 SQL, 5 XSS patterns. PII redacted.

V8 Sandbox: temp dir, no network, 128MB, 30s timeout.

Ed25519 Audit Trail: every action signed. Hash-chained. Verify all.

SQLite Memory: local only. Never transmitted.

## Testing

```
cd packages/core
npm install
npx vitest run    # 46/46 passing
npx tsc --noEmit  # 0 errors
```

## License

MIT

---

Built by VitalCheffe — 16, Casablanca, Morocco

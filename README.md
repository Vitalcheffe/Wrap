# WRAP NEBULA

<p align="center">The AI kernel for secure, local-first agentic infrastructure.<br/>Zero-trust. 100% private. Every skill verified before it runs.</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Rust-Governor-DEA584?logo=rust" />
  <img src="https://img.shields.io/badge/Tests-43%2F43-brightgreen" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

---

## Why

Every AI framework I tried either sent data to the cloud, ran arbitrary code without checking it, or was so complex I couldn't audit it.

I wanted something I could actually trust. So I built it.

## What it does

- Runs locally on your machine
- Responds on Telegram, Discord, or web
- Every skill is sandboxed — no native fs access without permission
- PII auto-redaction (SSN, credit cards, emails, phones)
- Ed25519 audit trail — cryptographically immutable

## Security model

```
User Input
  → InputSanitizer (prompt injection, SQL, XSS detection)
  → Core Engine (TypeScript)
  → Rust Safety Governor
      ├── Permissions (capability-based, zero by default)
      ├── InjectionFilter (prompt · SQL · XSS)
      ├── SandboxExecutor (node -e with timeout)
      └── AuditTrail (Ed25519 hash chain)
  → Policy Engine (YAML, hot-reload)
      ├── PII redaction
      └── Content policy
```

No config needed. Just markdown:

```markdown
# SOUL.md
Name: Aria
Personality: Curious and direct
Skills: web.search, files.read, reminder.set
Rules: Never share API keys. Ask before deleting.
```

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash
nebula init
nebula start
```

Your agent is live on Telegram. That's it.

## Architecture

```
wrap-nebula/
├── packages/
│   ├── core/          — Core engine (@wrap-nebula/core)
│   ├── cli/           — CLI tool (@wrap-nebula/cli)
│   ├── channels/
│   │   └── telegram/  — Telegram bot channel
│   └── js-sdk/        — JavaScript SDK (@wrap-nebula/ghost-sdk)
├── apps/
│   └── war-room/      — Dashboard (Next.js)
├── crates/
│   └── governor/      — Rust safety governor
├── skills/            — Skill definitions
└── install.sh         — One-line installer
```

## Skills

| Skill | Status | Description |
|-------|--------|-------------|
| `web.search` | ✅ | Search the web (DuckDuckGo scraping) |
| `files.read` | ✅ | Read files (path-restricted) |
| `files.write` | ✅ | Write files (path-restricted) |
| `files.list` | ✅ | List directory contents |
| `code.run` | ✅ | Execute code in sandbox (governor bridge) |
| `reminder.set` | ✅ | Set reminders (chrono-node + SQLite) |
| `reminder.list` | ✅ | List reminders |
| `git.status` | ✅ | Get git repository status |
| `calendar.read` | ✅ | Read calendar events (ical.js) |
| `email.summary` | ✅ | Summarize emails (mailparser) |

## Works with any model

Claude, GPT-4, or any Ollama model (free, local). One line in SOUL.md.

## CLI Commands

```bash
nebula init     # Interactive setup wizard
nebula start    # Start the agent
nebula stop     # Stop the agent
nebula status   # Show agent status
nebula config   # Manage configuration
nebula doctor   # Diagnose issues
```

## Telegram Commands

```
/start    — Start a conversation
/help     — Show available commands
/status   — Agent status
/reset    — Reset conversation
```

## Tests

```bash
npm test        # Run all tests (43 passing)
npm run build   # Build all packages
```

## Where it's at

| Version | What |
|---------|------|
| v8 (now) | Zero Trust core · Telegram · 10 skills · Memory · Full audit |
| v9 | Discord · Skill registry · 30+ skills · Docker |
| v10 | WhatsApp · Voice · Mobile app |
| v11 | Multi-agent workflows |

## Contributing

Write skills in TypeScript. Extend the Core. Audit the Rust Governor. Open an issue.

---

<p align="center">
  <sub>Amine Harch · 16 · Casablanca · <a href="https://vitalcheffe.github.io">vitalcheffe.github.io</a></sub>
</p>

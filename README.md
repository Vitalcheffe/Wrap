<h1 align="center">WRAP NEBULA</h1>
<p align="center">The AI kernel for secure, local-first agentic infrastructure.<br/>Zero-trust. 100% private. Every skill verified before it runs.</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Rust-Governor-DEA584?logo=rust" />
  <img src="https://img.shields.io/badge/Tests-29%2F29-brightgreen" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

---

## Why

Every AI framework I tried either sent data to the cloud, ran arbitrary code without checking it, or was so complex I couldn't audit it.

I wanted something I could actually trust. So I built it.

## What it does

- Runs locally on your machine
- Responds on Telegram, Discord, or web
- Every skill is sandboxed in V8 isolates — no native fs access
- PII auto-redaction (SSN, credit cards, emails, phones)
- Ed25519 audit trail — cryptographically immutable

## Security model

```
User Input
  → InputSanitizer (prompt injection detection)
  → Core Engine (TypeScript)
  → Rust Safety Governor
      ├── Permissions (capability-based, zero by default)
      ├── InjectionFilter (prompt · SQL · XSS)
      ├── SandboxExecutor (V8 isolate)
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

## Skills

`web.search` · `files.read` · `files.write` · `files.list` · `code.run` · `reminder.set` · `reminder.list` · `git.status`

## Works with any model

Claude, GPT-4, or any Ollama model (free, local). One line in SOUL.md.

## Where it's at

| Version | What |
|---|---|
| v7 (now) | Zero Trust core · Telegram · 10 skills · Memory |
| v8 | Discord · Skill registry · 30+ skills · Docker |
| v9 | WhatsApp · Voice · Mobile app |
| v10 | Multi-agent workflows |

## Contributing

Write skills in TypeScript. Extend the Core. Audit the Rust Governor. Open an issue.

---

<p align="center">
  <sub>Amine Harch · 16 · Casablanca · <a href="https://vitalcheffe.github.io">vitalcheffe.github.io</a></sub>
</p>

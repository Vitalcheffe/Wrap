<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Tests-46%2F46-brightgreen" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

<h1 align="center">WRAP NEBULA</h1>
<p align="center">The AI agent you can actually verify.<br/>Local-first. Zero-trust. Auditable by design.</p>

---

## The problem

Every coding agent sends your code to the cloud. No sandbox. No audit trail. No guarantees. You are trusting strangers with your proprietary code.

WRAP NEBULA does the opposite.

## What makes it different

| | Kilo Code | Cline | Cursor | **WRAP NEBULA** |
|---|---|---|---|---|
| Sandbox execution | no | no | no | **yes V8 isolate** |
| Signed audit trail | no | no | no | **yes Ed25519** |
| PII auto-redaction | no | no | no | **yes Automatic** |
| Local-first | yes | yes | no | **yes Default** |
| Zero API keys | no | no | no | **yes Ollama** |
| Telegram | no | no | no | **yes Built-in** |

## Install

See install.sh in the repo. Requires Ollama running locally.

## CLI

- nebula init — Setup wizard
- nebula start — Start the agent
- nebula stop — Stop the agent
- nebula status — Show status
- nebula doctor — Health check
- nebula skill — Manage skills

## Skills

14 sandboxed skills: web.search, files.read/write/list, code.run, code.edit, code.search, terminal.run, reminder.set/list, git.status, calendar.read, email.summary, project.context

## Status

- Core engine (Ollama/Claude/GPT-4) ✓
- 14 sandboxed skills ✓
- Ed25519 audit trail ✓
- Telegram bot ✓
- VS Code extension v0.9 ✓
- Plugin system ✓
- Multi-agent architecture ✓
- 46/46 tests passing ✓

## License

MIT

---

Built by VitalCheffe — 16, Casablanca

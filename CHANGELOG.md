# Changelog

All notable changes to WRAP NEBULA are documented here.

---

## [v7.0.0] — 2026-03-27 — Launch

### Added
- `install.sh` — one-line installer (`curl | bash`), detects OS automatically
- README rewritten — OpenClaw-style, English, ASCII architecture diagrams
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- GitHub Actions CI — TypeScript, Python, Rust jobs
- Issue templates — bug report and feature request

### Fixed
- `install.sh` URL now points to `raw.githubusercontent.com/Vitalcheffe/Wrap`
- Skills `calendar.read` and `email.summary` correctly marked as Coming Soon

---

## [v6.0.0] — 2026-03-27 — Community

### Added
- `packages/core/src/memory/` — `ConversationMemory` with SQLite persistence
  - Agent remembers context across sessions
  - Per-user, per-channel memory
  - Search through conversation history
- `install.sh` — first version of the one-line installer
- README updated with GitHub badges and comparison table

---

## [v5.0.0] — 2026-03-26 — First Contact

### Added
- `packages/cli/` — interactive onboarding wizard
  - `nebula init` → 5 questions, agent configured in under 2 minutes
  - No Python, no YAML, no config files required for basic setup
- `packages/channels/telegram/` — Telegram bot channel
  - Polling mode (no webhook or server needed)
  - `/start`, `/help`, `/status`, `/reset` commands
  - Rate limiting (5 messages/minute)
- `packages/core/src/skills/` — 10 built-in skills
  - `web.search`, `files.read`, `files.write`, `files.list`
  - `code.run`, `reminder.set`, `reminder.list`, `git.status`
  - `calendar.read` 🔜, `email.summary` 🔜
- `skills/default/SOUL.md` — agent identity definition in plain markdown
- `packages/core/src/soul/` — SOUL.md parser

---

## [v4.0.0] — 2026-03-26 — Stable

### Fixed
- TypeScript compilation: 76 errors → **0 errors**
- Regex bug in all 3 sanitizers — `"Forget everything above"` now correctly detected as injection
- War Room dashboard rebuilt with 5 React components
- Python test placeholder replaced with real assertions

### Result
- 29/29 tests passing
- All packages compile cleanly

---

## [v3.0.0] — 2026-03-26

### Fixed
- TypeScript: 76 errors → 0 (first clean compile)
- 27/29 tests passing (2 remaining regex bugs)

---

## [v2.0.0] — 2026-03-26

### Added
- War Room dashboard (Next.js) — 684 lines
- `server.ts` HTTP entry point in Core
- Integration and e2e test files

---

## [v1.0.0] — 2026-03-26 — Initial architecture

### Added
- Core Engine (TypeScript) — AgentRuntime, ToolsManager, VFS, SandboxBridge, MCP 2.0
- Python SDK thin client — InputSanitizer before LLM call
- JavaScript SDK thin client
- Rust Safety Governor — Permissions, Sandbox, AuditTrail (Ed25519), FilterEngine
- Policy Engine (YAML hot-reload) — PII and content rules separated from security
- `scripts/nebula` — single dev command

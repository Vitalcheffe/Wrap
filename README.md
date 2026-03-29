# WRAP NEBULA

The AI agent you can actually verify.

Local-first. Zero-trust. Auditable by design.

---

## The problem nobody talks about

Every AI coding agent on the market does the same thing: it takes your code, sends it to a cloud API, and hopes for the best. No sandbox. No audit trail. No cryptographic guarantees. You are trusting an external server with your proprietary source code, your API keys, your infrastructure.

Kilo Code raised $8 million and has 1.5 million users. Cline has 5 million installations. Cursor raised at a $9 billion valuation. They are all built on the same foundation: send your code to the cloud and pray.

WRAP NEBULA is built on the opposite foundation: **never trust, always verify**.

## What makes this different

| | Kilo | Cline | Cursor | **WRAP** |
|---|---|---|---|---|
| Code sandbox | no | no | no | **V8 isolate** |
| Audit trail | no | no | no | **Ed25519** |
| PII protection | no | no | no | **Auto-redact** |
| Local-first | partial | partial | no | **Default** |
| Zero API keys | no | no | no | **Ollama** |
| Telegram | no | no | no | **Built-in** |
| Open source | yes | yes | no | **MIT** |

## How it works

Every message flows through a pipeline where compromising one layer does not compromise the others:

1. **Input** - Telegram, CLI, VS Code, or web
2. **Input Sanitizer** - blocks prompt injection (10 patterns), SQL injection (6), XSS (5). PII redacted automatically
3. **Rust Governor** - separate process. Binary-level audit signing. Policy enforcement
4. **SOUL.md** - agent personality, skills, and rules in simple markdown
5. **LLM** - Ollama (local, free), Claude, or GPT-4. Auto-detected
6. **Skills** - 14 sandboxed executors
7. **Memory** - SQLite, local only, never transmitted
8. **Response** - signed, audited, delivered

## The 14 skills

- web.search - DuckDuckGo scraping, no API key
- files.read/write/list - path-restricted filesystem ops
- code.run - V8 sandboxed execution
- code.edit - diff-based editing with backup
- code.search - grep, find, symbol search
- terminal.run - shell commands with safety checks
- reminder.set/list - natural language dates, SQLite storage
- git.status - structured git output
- calendar.read - local .ics reader
- email.summary - local .mbox reader
- project.context - smart file inclusion for LLM

Every skill is hash-verified before loading. Sandbox blocks dangerous patterns.

## Install

```
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash
nebula init
nebula start
```

Requires Ollama running locally. No API keys needed.

## CLI

- nebula init - setup wizard
- nebula start - start the agent
- nebula stop - stop the agent
- nebula status - show config
- nebula doctor - health check
- nebula skill - manage skills
- nebula agents - multi-agent info

## VS Code Extension

- Chat panel - talk to your agent in VS Code
- Right-click actions - select code, explain/fix/review
- Audit trail tree - every signed action in real-time
- Status bar - agent online/offline

## Security

### Input Sanitizer
10 prompt injection patterns, 6 SQL patterns, 5 XSS patterns. PII auto-redacted: SSN, credit cards, emails, phones.

### V8 Sandbox
Temp HOME, minimal PATH, no network, 128MB memory, 30s timeout. Dangerous patterns blocked.

### Ed25519 Audit Trail
Every action signed. Hash-chained. Verify all with one function call. Immutable.

### SQLite Memory
Local only. Never transmitted. Never synced.

## Testing

```
cd packages/core
npm install
npx vitest run    # 46/46 passing
npx tsc --noEmit  # 0 errors
```

## Roadmap

- v8 Core agent, sandbox, audit, Telegram, CLI - Shipped
- v9 VS Code extension - Shipped
- v10 Plugin system - Shipped
- v11 Multi-agent - Shipped
- v12 Published extension, community - Active
- v13 Enterprise, SSO, compliance - Planned

## License

MIT

---

Built by VitalCheffe - 16, Casablanca, Morocco

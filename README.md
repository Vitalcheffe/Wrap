# Wrap (NEBULA)

A personal AI assistant that runs on your machine. Talks to you on Telegram, Discord, or web. No cloud, no subscription.

## The idea

I wanted an AI assistant I could actually trust. Every framework I tried either sent data to the cloud, ran arbitrary code without checking it, or was so complex I couldn't audit it.

So I built one where every skill is verified before it runs, there's a cryptographic audit trail, and nothing leaves your machine without permission.

## What it does

- Runs locally on your computer
- Responds on Telegram, Discord, or a web dashboard
- Skills are sandboxed in V8 isolates — no native fs access
- PII auto-redaction (SSN, credit cards, emails, phones)
- Everything gets logged with Ed25519 signatures

## Security model

The Rust Governor validates every action before it runs:
- Permission system — zero permissions by default
- Injection filter (prompt injection, SQL, XSS)
- V8 sandbox execution
- Immutable audit trail (Ed25519 hash chain)

The policy engine handles PII redaction and content rules. YAML config, hot-reload.

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash
nebula init    # interactive wizard, 5 questions
nebula start   # you're live on Telegram
```

## Skills

- web.search, files.read/write/list, code.run, reminder.set/list, git.status
- More coming in v8

## Works with any model

Claude, GPT-4, or any Ollama model (free, local). Just edit one line in SOUL.md.

## Where it's at

- v7 (now): Core, Telegram, 10 skills, memory, one-line install
- v8: Discord, skill registry, 30+ skills, Docker
- v9: WhatsApp, voice, mobile app
- v10: Multi-agent workflows

29/29 tests passing. 0 TypeScript errors. ~20K lines.

## Contributing

Write skills in TypeScript, extend the Core, or audit the Rust Governor. Open an issue if you find something.

# 🛡️ WRAP NEBULA

<p align="center">
  <b>The AI agent kernel you can actually verify.</b><br>
  <i>Local-first. Zero-trust. Auditable by design.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Rust-Governor-da5a2a?logo=rust" />
  <img src="https://img.shields.io/badge/TypeScript-Agent-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Sandbox-V8%20Isolate-green" />
  <img src="https://img.shields.io/badge/Audit-Ed25519-purple" />
  <img src="https://img.shields.io/badge/LLM-Ollama%20%7C%20Claude%20%7C%20GPT--4-FF6B6B" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" />
</p>

---

**WRAP NEBULA is a local-first AI agent kernel that runs entirely on your machine.** Every action is sandboxed, signed, and auditable. Your code never leaves your device — no cloud, no trust, no compromise.

---

## 🚀 The Story

> **Every AI coding agent sends your code to the cloud. No sandbox. No audit trail. No cryptographic guarantees. You are trusting strangers with your proprietary code.**
>
> **Kilo Code raised $8M. Cline has 5M installs. Cursor is worth $9B. They all do the same thing: send your code to a server you don't control.**
>
> **WRAP NEBULA does the opposite. Your code never leaves your machine. Every action is signed, sandboxed, and auditable.**

---

## Why WRAP NEBULA?

| | Kilo | Cline | Cursor | **WRAP** |
|---|---|---|---|---|
| **Sandbox** | ❌ | ❌ | ❌ | ✅ **V8 isolate** |
| **Audit trail** | ❌ | ❌ | ❌ | ✅ **Ed25519 signed** |
| **PII redaction** | ❌ | ❌ | ❌ | ✅ **Automatic** |
| **Local-first** | partial | partial | ❌ | ✅ **Default** |
| **Free forever** | ❌ | ❌ | ❌ | ✅ **Yes** |
| **Telegram** | ❌ | ❌ | ❌ | ✅ **Built-in** |

---

## How It Works

Every message flows through a layered pipeline where compromising one layer does not compromise the others:

```
1. Input          → Telegram, CLI, VS Code
2. Sanitizer      → blocks injection, redacts PII
3. Rust Governor  → separate process, policy enforcement
4. SOUL.md        → agent personality in markdown
5. LLM           → Ollama / Claude / GPT-4
6. Skills         → sandboxed executors (V8 isolate)
7. Memory         → SQLite, local only
8. Response       → signed, auditable
```

---

## Architecture

```
Wrap/
├── apps/
│   ├── vscode/          # VS Code extension
│   └── war-room/        # Web dashboard
├── crates/
│   └── governor/        # Rust policy enforcement engine
├── packages/
│   └── core/            # Agent kernel, skills, memory
├── skills/
│   └── default/         # Built-in skill definitions
├── policy/              # Governance policies
├── scripts/             # Install & utility scripts
└── tests/               # Integration tests
```

---

## 🛠️ Skills

14 sandboxed executors — each runs in a V8 isolate with no filesystem or network access unless explicitly granted:

| Skill | Description |
|-------|-------------|
| **web.search** | DuckDuckGo scraping, no API key needed |
| **code.execute** | Sandboxed Python / JS / TS execution |
| **file.read / write** | Scoped to workspace only |
| **system.info** | CPU, memory, disk stats |
| **memory.search** | Semantic search over local SQLite |
| **+ 9 more** | Extensible via `SkillDefinition` |

---

## 🚀 Quick Start

```bash
# Authenticate with your LLM provider
nebula auth login anthropic

# One-line install
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash

# Start (Ollama must be running for local models)
ollama serve && ollama pull llama3 && nebula start
```

### Prerequisites

| Requirement | Version |
|-------------|---------|
| **Node.js** | 18+ |
| **npm** | 9+ |
| **Rust** | 1.70+ (optional, for the Safety Governor) |
| **Ollama** | Latest (for local LLM inference) |

---

## 🔧 Development

```bash
git clone https://github.com/Vitalcheffe/Wrap.git
cd Wrap
npm install

# Optional: build the Rust Governor
cd crates/governor && cargo build --release && cd ../..

# Run tests
npm test
```

---

## Adding a New Skill

Skills live in `packages/core/src/skills/definitions/`. Each skill exports a `SkillDefinition`:

```typescript
import { SkillDefinition } from '../index';

export const mySkill: SkillDefinition = {
  name: 'my.skill',
  description: 'What this skill does',
  parameters: { /* JSON Schema */ },
  execute: async (params, context) => {
    // Sandboxed execution — no filesystem, no network
    // unless explicitly granted in policy
    return result;
  },
};
```

---

## Connection Modes

1. **CLI** — Run `nebula` directly in your terminal
2. **VS Code** — Install the WRAP extension from `apps/vscode/`
3. **Telegram** — Connect your bot token for remote agent control
4. **War Room** — Web dashboard at `http://localhost:3000`

---

## Security Model

- **V8 Isolates**: Every skill runs in a sandboxed JavaScript runtime with no access to filesystem or network unless explicitly granted
- **Ed25519 Signing**: Every agent response is cryptographically signed for auditability
- **Rust Governor**: A separate process (not JavaScript) enforces policies — even if the agent is compromised, the governor holds
- **PII Redaction**: Automatic detection and removal of sensitive data before it reaches the LLM
- **Local-first**: No data ever leaves your machine unless you explicitly configure a cloud LLM

---

## Contributing

**Contributions are what make the open-source community such an amazing place!**

1. **Fork the Project**
2. **Create your Feature Branch** (`git checkout -b feature/AmazingFeature`)
3. **Commit your Changes** (`git commit -m 'Add some AmazingFeature'`)
4. **Push to the Branch** (`git push origin feature/AmazingFeature`)
5. **Open a Pull Request**

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">Made with ❤️ and 🛡️ by Amine Harch el Korane</p>

![WRAP NEBULA](https://socialify.git.ci/Vitalcheffe/Wrap/image?description=1&forks=1&issues=1&language=1&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Dark)

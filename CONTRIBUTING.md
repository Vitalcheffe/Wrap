# Contributing to WRAP NEBULA

Thanks for your interest in contributing! WRAP NEBULA is an open-source project and we welcome contributions of all kinds.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Rust 1.70+ (optional, for the Safety Governor)
- Git

### Setup

```bash
git clone https://github.com/Vitalcheffe/Wrap.git
cd Wrap
npm install

# Optional: build the Rust Governor
cd crates/governor && cargo build --release && cd ../..

# Run tests
npm test
```

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists
2. Create a new issue with:
   - Clear title starting with `[Bug]`
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment (OS, Node version, WRAP version)

### Suggesting Features

1. Create an issue with `[Feature]` prefix
2. Describe the use case
3. Propose an implementation approach

### Adding a New Skill

Skills live in `packages/core/src/skills/definitions/`. Each skill exports a `SkillDefinition`:

```typescript
import { SkillDefinition } from '../index';

export const mySkill: SkillDefinition = {
  name: 'my.skill',
  description: 'What this skill does',
  parameters: {
    param1: { type: 'string', description: 'Parameter description', required: true },
  },
  async execute(params: Record<string, unknown>) {
    // Implementation
    return { success: true, output: 'Result' };
  },
};
```

Then add it to `packages/core/src/skills/definitions/index.ts`.

### Pull Request Process

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Write tests for new functionality
5. Ensure all tests pass: `npm test`
6. Ensure zero TypeScript errors: `npx tsc --noEmit`
7. Commit with conventional format: `feat: description` or `fix: description`
8. Push and open a PR against `main`

### Code Style

- **TypeScript strict** — no `any`, use `unknown` and narrow properly
- **No TODOs** — implement or delete
- **Every function needs JSDoc** — `@param`, `@returns`, one-line description
- **Error handling** — every `catch` must log with context
- **Tests required** — every new feature needs tests

### Commit Convention

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `test:` — adding tests
- `chore:` — maintenance (deps, CI, config)
- `refactor:` — code change that neither fixes a bug nor adds a feature

## Architecture

```
Wrap/
├── packages/core/        ← Main agent engine
├── packages/cli/         ← nebula init/start commands
├── packages/channels/    ← Telegram, Discord (coming)
├── apps/war-room/        ← Web dashboard
├── crates/governor/      ← Rust security layer
├── skills/default/       ← SOUL.md agent definition
└── policy/               ← YAML security policies
```

### Message Flow

```
User Message
  → InputSanitizer (injection detection)
  → SOULParser (load agent personality)
  → AgentRuntime (process with LLM)
  → ToolsManager (execute skills if needed)
  → Memory (save to SQLite)
  → Response to user
```

## Security

WRAP NEBULA takes security seriously:

- All skills are sandboxed (V8 isolates)
- Every action is logged with Ed25519 signatures
- PII is auto-redacted
- Path traversal is blocked
- Dangerous commands are filtered

If you find a security vulnerability, please email instead of opening a public issue.

## Questions?

Open a Discussion or reach out on Telegram.

---

Built with ❤️ by [VitalCheffe](https://github.com/Vitalcheffe) — 16, Casablanca 🇲🇦

# Contributing to WRAP NEBULA

Thanks for your interest. NEBULA is MIT — contributions are welcome from developers, students, and security researchers at any level.

---

## Ways to contribute

- **Report bugs** → open an issue with the bug report template
- **Suggest features** → open an issue with the feature request template
- **Write a skill** → the fastest way to add real value
- **Improve docs** → fix typos, add examples, translate
- **Review pull requests** → test on your machine and comment
- **Security audit** → especially the Rust Governor — see [Security Policy](SECURITY.md)

---

## Writing a skill

Skills live in `packages/core/src/skills/definitions/`. Each skill is a single TypeScript file.

```typescript
// packages/core/src/skills/definitions/my.skill.ts
import { SkillDefinition } from '../index.js';

export const mySkill: SkillDefinition = {
  name: 'my.skill',
  description: 'One sentence description of what this skill does',

  // Declare permissions upfront — the Rust Governor enforces these.
  // If your skill tries to do something not listed here, it is BLOCKED.
  permissions: ['network.http'],   // or: filesystem.read, filesystem.write, process.exec

  safe: true,   // false = requires explicit user confirmation before each run

  parameters: {
    query: { type: 'string', required: true, description: 'Search query' }
  },

  handler: async (params, context) => {
    // Your logic here
    return { result: 'output text' };
  }
};
```

Then register it in `packages/core/src/skills/definitions/index.ts`:

```typescript
export { mySkill } from './my.skill.js';
```

Run `cd packages/core && npx tsc --noEmit` — zero errors required before opening a PR.

---

## Development setup

```bash
git clone https://github.com/Vitalcheffe/Wrap.git
cd Wrap
npm install

# Start everything (Governor + Core + Dashboard)
./scripts/nebula dev

# TypeScript — must stay at 0 errors
cd packages/core && npx tsc --noEmit

# Tests — must stay at 29/29
python -m pytest tests/ -o "addopts=" -v

# Rust Governor (requires Rust toolchain)
cd crates/governor && cargo build --release && cargo test
```

---

## Pull request rules

1. **TSC must pass** — `npx tsc --noEmit` with zero errors
2. **Tests must pass** — 29/29 minimum, add tests for new features
3. **One PR, one thing** — don't mix a new skill with a refactor
4. **Write in English** — issues and PRs, any language is fine in comments
5. **No breaking changes to the Core API** without a discussion first
6. **Skills must declare permissions** — no `permissions: []` for skills that touch the network or filesystem

---

## Security contributions

The Rust Governor is the most critical component. If you find a bypass:

1. Do **not** open a public issue
2. Open a [private security advisory](https://github.com/Vitalcheffe/Wrap/security/advisories/new)
3. We will respond within 72 hours

See [SECURITY.md](SECURITY.md) for the full policy.

---

## Code style

- TypeScript: no `any`, explicit return types on public functions
- Python: type hints on all function signatures
- Rust: `clippy` warnings must be clean (`cargo clippy -- -D warnings`)
- Commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `test:` prefixes

---

## First contribution? Start here

Issues labeled [`good first issue`](https://github.com/Vitalcheffe/Wrap/labels/good%20first%20issue) are small, well-defined, and documented. Pick one, comment that you're working on it, and open a draft PR early so we can help.

---

*WRAP NEBULA — Your AI. Your machine. Your rules.* 🌌

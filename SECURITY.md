# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| v7.x    | ✅ Active  |
| < v7    | ❌ No      |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Open a [private security advisory](https://github.com/Vitalcheffe/Wrap/security/advisories/new) directly on GitHub. We will respond within 72 hours.

Include:
- Description of the vulnerability
- Component affected (Governor, Core, SDK, skill)
- Steps to reproduce
- Potential impact

## Scope

The Rust Safety Governor is the highest-priority security component. Vulnerabilities there — especially sandbox escapes, permission bypass, or audit trail tampering — are treated as critical.

We especially welcome research on:
- V8 sandbox escapes via the skill execution path
- Permission system bypasses
- Prompt injection detection gaps
- Ed25519 audit chain integrity

## What we will do

- Acknowledge within 72 hours
- Provide a fix timeline within 7 days
- Credit you in the release notes (unless you prefer anonymity)
- Never share your report publicly before a fix is available

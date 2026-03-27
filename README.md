<p align="center">
  <img src="https://raw.githubusercontent.com/wrap-nebula/nebula/main/assets/logo.png" alt="NEBULA" width="200">
</p>

<p align="center">
  <strong>🌌 WRAP NEBULA</strong>
</p>

<p align="center">
  <em>Ton IA personnelle. Gratuite. Que tu peux donner à ta mère sans avoir peur.</em>
</p>

<p align="center">
  <a href="#-installation-en-30-secondes">Installation</a> •
  <a href="#-pourquoi-nebula">Pourquoi ?</a> •
  <a href="#-fonctionnalités">Fonctionnalités</a> •
  <a href="#-usage">Usage</a> •
  <a href="#-documentation">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/Vitalcheffe/Wrap/actions/workflows/test.yml">
    <img src="https://github.com/Vitalcheffe/Wrap/actions/workflows/test.yml/badge.svg" alt="Tests">
  </a>
  <a href="https://github.com/Vitalcheffe/Wrap/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <a href="https://github.com/Vitalcheffe/Wrap/releases">
    <img src="https://img.shields.io/github/v/release/Vitalcheffe/Wrap?color=brightgreen" alt="Version">
  </a>
  <img src="https://img.shields.io/badge/Zero%20Trust-Verified-brightgreen?logo=shield&logoColor=white" alt="Zero Trust Verified">
</p>

---

## 🚀 Installation en 30 secondes

```bash
curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash
```

Puis :

```bash
nebula init    # Configuration guidée
nebula start   # C'est parti !
```

<details>
<summary>📷 Voir le wizard en action</summary>

```
🌌 Bienvenue dans WRAP NEBULA

? Quel modèle veux-tu utiliser ?
  ● Claude (Anthropic) — recommandé
  ○ GPT-4 (OpenAI)
  ○ Llama 3 local (gratuit, offline)

? Colle ta clé API : sk-ant-********
  (Pas de clé ? → https://console.anthropic.com)

? Par où veux-tu parler à ton agent ?
  ☑ Telegram (recommandé pour débutants)
  ☑ Discord
  ○ Interface web uniquement

✓ Configuration terminée en 47 secondes.
```

</details>

---

## 🤔 Pourquoi NEBULA ?

### Le problème

| OpenClaw | NEBULA |
|----------|--------|
| ⚠️ **41% des skills contiennent des vulnérabilités** | ✅ **Chaque skill passe par le Rust Governor** |
| ❌ Aucun audit trail | ✅ Hash chain Ed25519 immuable |
| ❌ Pas de vérification de sécurité | ✅ Zero Trust par design |
| ✅ Beginner friendly | ✅ **Beginner friendly + Sécurisé** |

### La différence NEBULA

**OpenClaw a gagné sur l'expérience** (10 minutes, zéro code). **Mais a perdu sur la sécurité** — une faille critique (CVE-2026-25253) permettait une exécution de code à distance.

**NEBULA combine les deux** : l'expérience "10 minutes" avec une architecture Zero Trust qui empêche **par design** toute exfiltration de données.

> *"Ton IA personnelle. Gratuite. Que tu peux donner à ta mère sans avoir peur."*

---

## ✨ Fonctionnalités

### 🔐 Zero Trust Architecture

- **Rust Governor** : chaque appel système passe par un sandbox en Rust
- **Audit Trail** : hash chain Ed25519 immuable, impossible à falsifier
- **Input Sanitizer** : détection d'injection AVANT l'envoi au LLM
- **Policy Engine** : règles YAML avec hot-reload

### 🧠 Mémoire Persistante

```markdown
[Lundi] Toi : "mon rendez-vous dentiste c'est le 15 avril"
[Vendredi] Toi : "c'est quand mon rdv dentiste déjà ?"
Agent : "Le 15 avril — dans 11 jours. Tu veux un rappel la veille ?"
```

L'agent se souvient entre les sessions, sur tous les canaux.

### 💬 Multi-Canal

| Canal | Status | Utilisation |
|-------|--------|-------------|
| Telegram | ✅ Stable | Débutants |
| Discord | ✅ Stable | Communauté dev |
| Web UI | ✅ Stable | War Room dashboard |
| WhatsApp | 🔜 Bientôt | Grand public |

### 🛠️ 10+ Skills Intégrées

| Skill | Usage | Sécurité |
|-------|-------|----------|
| `web.search` | Recherche web | ✅ Validé |
| `files.read` | Lire fichiers | ✅ Sandbox |
| `files.write` | Modifier fichiers | ✅ Confirmation requise |
| `files.list` | Lister dossiers | ✅ Safe |
| `code.run` | Exécuter code | ✅ Isolé |
| `reminder.set` | Créer rappels | ✅ Safe |
| `reminder.list` | Voir rappels | ✅ Safe |
| `calendar.read` | Lire agenda | 🔜 *Coming Soon* |
| `email.summary` | Résumer emails | 🔜 *Coming Soon* |
| `git.status` | Statut repo | ✅ Read-only |

### 📝 SOUL.md — Personnalité de ton Agent

```markdown
# Mon Agent NEBULA

Nom: Aria
Personnalité: Assistante curieuse et directe
Langue: Français

Capacités activées:
- web.search
- files.read

Règles:
- Ne jamais partager mes clés API
- Demander confirmation avant de supprimer
```

---

## 📖 Usage

### Commandes CLI

```bash
nebula init      # Configuration guidée interactive
nebula start     # Démarrer l'agent
nebula stop      # Arrêter l'agent
nebula status    # Voir l'état
nebula doctor    # Diagnostic
nebula config    # Modifier la config
```

### Configuration

Fichier : `~/.nebula/config.yaml`

```yaml
model:
  provider: anthropic
  model: claude-sonnet-4-20250514

channels:
  - type: telegram
    enabled: true
  - type: discord
    enabled: false

agent:
  name: Aria
  language: Français
  skills:
    - web.search
    - files.read

memory:
  enabled: true
  backend: sqlite

security:
  auditTrail: true
  sandboxEnabled: true
```

### API Programmatique

```typescript
import { Ghost } from '@wrap-nebula/sdk';

const agent = new Ghost({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
});

const response = await agent.run("Quel temps fait-il à Paris ?");
console.log(response.content);
```

```python
from wrap_ghost import Ghost, GhostConfig

agent = Ghost(GhostConfig(
    provider="anthropic",
    model="claude-sonnet-4-20250514",
))

response = await agent.run("Quel temps fait-il à Paris ?")
print(response.content)
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CHANNELS LAYER                          │
│  Telegram │ Discord │ Web UI │ WhatsApp │ Slack │ Matrix    │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    SDK LAYER (Thin Clients)                  │
│     Python SDK (600 loc) │ JavaScript SDK (600 loc)         │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                     CORE ENGINE (TypeScript)                 │
│  Agent Runtime │ Tool Manager │ State Manager │ MCP 2.0     │
│  Input Sanitizer │ Policy Engine │ Circuit Breaker          │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                  RUST GOVERNOR (Security Layer)              │
│  Permissions │ Sandbox │ Audit Trail (Ed25519) │ Filters    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧪 Tests

```bash
# Tests unitaires
npm test

# Tests d'intégration
PYTHONPATH=packages/python-sdk python -m pytest tests/

# Couverture
npm run coverage
```

**État actuel : 29/29 tests passent ✅**

---

## 📁 Structure du Projet

```
nebula/
├── packages/
│   ├── core/           # Moteur TypeScript (~9k loc)
│   ├── cli/            # CLI avec wizard interactif
│   ├── channels/
│   │   └── telegram/   # Channel Telegram
│   ├── python-sdk/     # SDK Python (~1.5k loc)
│   └── js-sdk/         # SDK JavaScript (~1k loc)
├── crates/
│   └── governor/       # Rust Safety Governor (~1.2k loc)
├── apps/
│   └── war-room/       # Dashboard React
├── skills/
│   └── default/        # Skills intégrées
└── tests/              # Tests d'intégration
```

---

## 🛡️ Sécurité

### Badge Zero Trust Verified

Chaque skill publiée sur NebulaHub est :

1. **Scannée** pour les vulnérabilités
2. **Exécutée en sandbox** par le Rust Governor
3. **Auditée** dans la hash chain Ed25519
4. **Signée** cryptographiquement

### Signaler une vulnérabilité

security@nebula.dev ou via GitHub Security Advisories.

---

## 🗺️ Roadmap

| Version | Focus | Status |
|---------|-------|--------|
| v5 "First Contact" | CLI + Telegram + Skills | ✅ Stable |
| v6 "Community" | Discord + NebulaHub + Mémoire cross-sessions | 🚧 En cours |
| v7 "Launch" | One-click install + 50 skills | 📅 Q2 2026 |
| v8 "Enterprise" | SSO + RBAC + On-premise | 📅 Q3 2026 |

---

## 🤝 Contribuer

```bash
git clone https://github.com/wrap-nebula/nebula
cd nebula
npm install
npm run dev
```

Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour les guidelines.

---

## 📄 License

MIT © 2024-2026 WRAP NEBULA Team

---

## 💬 Communauté

- [Discord](https://discord.gg/nebula) — Support et discussions
- [Twitter](https://twitter.com/wrapnebula) — Actualités
- [Blog](https://blog.nebula.dev) — Articles techniques

---

<p align="center">
  <strong>Fait avec ❤️ pour une IA locale, sécurisée, et accessible à tous.</strong>
</p>

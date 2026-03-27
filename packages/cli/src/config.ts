/**
 * WRAP NEBULA CLI - Config Management
 * Handles configuration file at ~/.nebula/config.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse, stringify } from 'yaml';

// ============================================================================
// Types
// ============================================================================

export interface NebulaConfig {
  version: string;
  model: ModelConfig;
  channels: ChannelConfig[];
  agent: AgentConfig;
  created: number;
  updated: number;
}

export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ChannelConfig {
  type: 'telegram' | 'discord' | 'web';
  enabled: boolean;
  token?: string;
  webhookUrl?: string;
}

export interface AgentConfig {
  name: string;
  personality: string;
  language: string;
  skills: string[];
  rules: string[];
}

export interface SOULConfig {
  name: string;
  personality: string;
  language: string;
  skills: string[];
  rules: string[];
}

// ============================================================================
// Constants
// ============================================================================

const NEBULA_DIR = '.nebula';
const CONFIG_FILE = 'config.yaml';
const SOUL_FILE = 'SOUL.md';

const DEFAULT_CONFIG: NebulaConfig = {
  version: '1.0.0',
  model: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  channels: [
    { type: 'telegram', enabled: false },
    { type: 'discord', enabled: false },
    { type: 'web', enabled: true },
  ],
  agent: {
    name: 'Aria',
    personality: 'Assistante curieuse et directe',
    language: 'Français',
    skills: ['web.search', 'files.read'],
    rules: [
      'Ne jamais partager mes clés API',
      'Demander confirmation avant de supprimer',
    ],
  },
  created: Date.now(),
  updated: Date.now(),
};

const DEFAULT_SOUL = `# Mon Agent NEBULA

Nom: Aria
Personnalité: Assistante curieuse et directe
Langue: Français

Capacités activées:
- web.search
- files.read

Règles:
- Ne jamais partager mes clés API
- Demander confirmation avant de supprimer
- Être concis dans les réponses
- Proposer des alternatives si une action n'est pas possible

## À propos

Je suis Aria, votre agent NEBULA personnel. Je suis là pour vous aider
dans vos tâches quotidiennes, répondre à vos questions et automatiser
vos workflows.

Je peux:
- 🔍 Rechercher sur le web
- 📁 Lire et analyser vos fichiers
- ⏰ Créer des rappels
- 💻 Exécuter du code en sandbox

N'hésitez pas à me poser des questions !
`;

// ============================================================================
// Config Manager
// ============================================================================

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private soulPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), NEBULA_DIR);
    this.configPath = path.join(this.configDir, CONFIG_FILE);
    this.soulPath = path.join(this.configDir, SOUL_FILE);
  }

  /**
   * Get the config directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Check if config exists
   */
  exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Check if SOUL.md exists
   */
  soulExists(): boolean {
    return fs.existsSync(this.soulPath);
  }

  /**
   * Load configuration
   */
  load(): NebulaConfig | null {
    try {
      if (!this.exists()) {
        return null;
      }

      const content = fs.readFileSync(this.configPath, 'utf-8');
      const config = parse(content) as NebulaConfig;
      
      return config;
    } catch (error) {
      console.error('Failed to load config:', error);
      return null;
    }
  }

  /**
   * Save configuration
   */
  save(config: NebulaConfig): void {
    // Ensure directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    // Update timestamp
    config.updated = Date.now();

    // Write config
    const content = stringify(config);
    fs.writeFileSync(this.configPath, content, 'utf-8');
  }

  /**
   * Create default configuration
   */
  createDefault(): NebulaConfig {
    const config = {
      ...DEFAULT_CONFIG,
      created: Date.now(),
      updated: Date.now(),
    };

    this.save(config);

    // Create default SOUL.md if not exists
    if (!this.soulExists()) {
      this.createDefaultSoul();
    }

    return config;
  }

  /**
   * Create default SOUL.md
   */
  createDefaultSoul(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.soulPath, DEFAULT_SOUL, 'utf-8');
  }

  /**
   * Load SOUL.md content
   */
  loadSoul(): string {
    try {
      if (!this.soulExists()) {
        return DEFAULT_SOUL;
      }
      return fs.readFileSync(this.soulPath, 'utf-8');
    } catch {
      return DEFAULT_SOUL;
    }
  }

  /**
   * Save SOUL.md content
   */
  saveSoul(content: string): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.soulPath, content, 'utf-8');
  }

  /**
   * Update model configuration
   */
  updateModel(modelConfig: Partial<ModelConfig>): NebulaConfig | null {
    const config = this.load();
    if (!config) return null;

    config.model = { ...config.model, ...modelConfig };
    this.save(config);
    return config;
  }

  /**
   * Update channels configuration
   */
  updateChannels(channels: ChannelConfig[]): NebulaConfig | null {
    const config = this.load();
    if (!config) return null;

    config.channels = channels;
    this.save(config);
    return config;
  }

  /**
   * Update agent configuration
   */
  updateAgent(agentConfig: Partial<AgentConfig>): NebulaConfig | null {
    const config = this.load();
    if (!config) return null;

    config.agent = { ...config.agent, ...agentConfig };
    this.save(config);
    return config;
  }

  /**
   * Get config path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get SOUL.md path
   */
  getSoulPath(): string {
    return this.soulPath;
  }

  /**
   * Delete configuration
   */
  delete(): boolean {
    try {
      if (fs.existsSync(this.configDir)) {
        fs.rmSync(this.configDir, { recursive: true });
      }
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export const configManager = new ConfigManager();

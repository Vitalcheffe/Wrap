/**
 * WRAP NEBULA — Plugin System
 * Skill manifest, loader, registry, and verification
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Skill manifest (wrap-skill.json)
 * Every skill package must include this file at its root
 */
export interface SkillManifest {
  /** Unique skill name (e.g., "weather.check") */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description: string;
  /** Author info */
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  /** License */
  license: string;
  /** Entry point (relative to manifest) */
  main: string;
  /** Skill category */
  category: 'web' | 'code' | 'system' | 'data' | 'communication' | 'custom';
  /** Required permissions */
  permissions: string[];
  /** Whether skill has side effects */
  dangerous: boolean;
  /** Dependencies (other skill names) */
  dependencies?: string[];
  /** Keywords for discovery */
  keywords?: string[];
  /** Repository URL */
  repository?: string;
  /** SHA-256 hash of the main file (for verification) */
  hash?: string;
  /** Ed25519 signature of the hash (for trust) */
  signature?: string;
}

/**
 * Installed skill entry
 */
export interface InstalledSkill {
  manifest: SkillManifest;
  installPath: string;
  installedAt: number;
  verified: boolean;
}

/**
 * Registry entry (for remote discovery)
 */
export interface RegistryEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  downloads: number;
  verified: boolean;
  repository: string;
}

// ============================================================================
// Skill Loader
// ============================================================================

const SKILLS_DIR = process.env.WRAP_SKILLS_DIR || path.join(os.homedir(), '.wrap', 'skills-installed');

export class SkillLoader {
  private skillsDir: string;
  private loaded: Map<string, InstalledSkill> = new Map();

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || SKILLS_DIR;
    fs.mkdirSync(this.skillsDir, { recursive: true });
  }

  /**
   * Discover all installed skills
   */
  discover(): InstalledSkill[] {
    const skills: InstalledSkill[] = [];

    if (!fs.existsSync(this.skillsDir)) return skills;

    for (const dir of fs.readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;

      const manifestPath = path.join(this.skillsDir, dir.name, 'wrap-skill.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const verified = this.verifySkill(dir.name);

        skills.push({
          manifest,
          installPath: path.join(this.skillsDir, dir.name),
          installedAt: fs.statSync(path.join(this.skillsDir, dir.name)).birthtimeMs,
          verified,
        });
      } catch {
        // Skip malformed skills
      }
    }

    return skills;
  }

  /**
   * Load a skill dynamically
   */
  async load(skillName: string): Promise<unknown> {
    const skillDir = path.join(this.skillsDir, skillName);
    const manifestPath = path.join(skillDir, 'wrap-skill.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Skill "${skillName}" not installed`);
    }

    const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Verify before loading
    if (manifest.hash) {
      const verified = this.verifySkill(skillName);
      if (!verified) {
        throw new Error(`Skill "${skillName}" failed verification — hash mismatch`);
      }
    }

    // Load the module
    const mainPath = path.resolve(skillDir, manifest.main);
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Skill "${skillName}" main file not found: ${manifest.main}`);
    }

    const module = await import(mainPath);
    this.loaded.set(skillName, {
      manifest,
      installPath: skillDir,
      installedAt: Date.now(),
      verified: !!manifest.hash,
    });

    return module;
  }

  /**
   * Install a skill from a directory or tarball
   */
  install(sourcePath: string): InstalledSkill {
    // Check for manifest
    const manifestPath = path.join(sourcePath, 'wrap-skill.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('No wrap-skill.json found in source');
    }

    const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Validate manifest
    if (!manifest.name) throw new Error('Skill manifest missing "name"');
    if (!manifest.version) throw new Error('Skill manifest missing "version"');
    if (!manifest.main) throw new Error('Skill manifest missing "main"');

    // Check if already installed
    const destDir = path.join(this.skillsDir, manifest.name);
    if (fs.existsSync(destDir)) {
      const existing: SkillManifest = JSON.parse(
        fs.readFileSync(path.join(destDir, 'wrap-skill.json'), 'utf-8')
      );
      if (existing.version === manifest.version) {
        throw new Error(`Skill "${manifest.name}@${manifest.version}" already installed`);
      }
    }

    // Copy to skills directory
    fs.mkdirSync(destDir, { recursive: true });
    this.copyDir(sourcePath, destDir);

    // Compute hash
    const mainPath = path.resolve(destDir, manifest.main);
    if (fs.existsSync(mainPath)) {
      const hash = this.computeHash(mainPath);
      manifest.hash = hash;
      fs.writeFileSync(path.join(destDir, 'wrap-skill.json'), JSON.stringify(manifest, null, 2));
    }

    return {
      manifest,
      installPath: destDir,
      installedAt: Date.now(),
      verified: !!manifest.hash,
    };
  }

  /**
   * Uninstall a skill
   */
  uninstall(skillName: string): void {
    const skillDir = path.join(this.skillsDir, skillName);
    if (!fs.existsSync(skillDir)) {
      throw new Error(`Skill "${skillName}" not installed`);
    }
    fs.rmSync(skillDir, { recursive: true, force: true });
    this.loaded.delete(skillName);
  }

  /**
   * Verify a skill's integrity
   */
  verifySkill(skillName: string): boolean {
    const manifestPath = path.join(this.skillsDir, skillName, 'wrap-skill.json');
    if (!fs.existsSync(manifestPath)) return false;

    const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!manifest.hash) return true; // No hash = not verified but not suspicious

    const mainPath = path.resolve(path.join(this.skillsDir, skillName), manifest.main);
    if (!fs.existsSync(mainPath)) return false;

    const actualHash = this.computeHash(mainPath);
    return actualHash === manifest.hash;
  }

  /**
   * Compute SHA-256 of a file
   */
  private computeHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Copy directory recursively
   */
  private copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// ============================================================================
// Skill Registry (GitHub-based)
// ============================================================================

const REGISTRY_URL = 'https://raw.githubusercontent.com/Vitalcheffe/wrap-skills/main/registry.json';

export class SkillRegistry {
  private localRegistry: Map<string, RegistryEntry> = new Map();

  /**
   * Fetch the remote registry
   */
  async fetchRemote(): Promise<RegistryEntry[]> {
    try {
      const response = await fetch(REGISTRY_URL);
      if (!response.ok) return [];
      const data = await response.json() as { skills: RegistryEntry[] };
      for (const entry of data.skills) {
        this.localRegistry.set(entry.name, entry);
      }
      return data.skills;
    } catch {
      return [];
    }
  }

  /**
   * Search skills by keyword
   */
  search(query: string): RegistryEntry[] {
    const q = query.toLowerCase();
    return Array.from(this.localRegistry.values()).filter(entry =>
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.author.toLowerCase().includes(q)
    );
  }

  /**
   * Get a specific skill from registry
   */
  get(name: string): RegistryEntry | undefined {
    return this.localRegistry.get(name);
  }

  /**
   * List all known skills
   */
  list(): RegistryEntry[] {
    return Array.from(this.localRegistry.values());
  }
}

/**
 * WRAP NEBULA — Auth Profile Manager
 * Inspired by OpenClaw's AuthProfileManager
 * Stores credentials in ~/.nebula/auth-profiles.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const AUTH_PROFILES_PATH = path.join(os.homedir(), '.nebula', 'auth-profiles.json');

// ============================================================================
// Types (compatible with OpenClaw's format)
// ============================================================================

export interface ApiKeyCredential {
  type: 'api_key';
  provider: string;
  key: string;
  email?: string;
  createdAt: number;
}

export interface TokenCredential {
  type: 'token';
  provider: string;
  token: string;
  expires?: number;
  createdAt: number;
}

export type AuthCredential = ApiKeyCredential | TokenCredential;

export interface AuthProfileStore {
  version: number;
  profiles: Record<string, AuthCredential>; // keyed by "provider:profileId"
  lastGood?: Record<string, string>; // provider → profileId of last successful
}

// ============================================================================
// Auth Profile Manager
// ============================================================================

export class AuthProfileManager {
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath || AUTH_PROFILES_PATH;
  }

  /**
   * Load the auth store from disk
   */
  private load(): AuthProfileStore {
    try {
      return JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
    } catch {
      return { version: 1, profiles: {} };
    }
  }

  /**
   * Save the auth store to disk
   */
  private save(store: AuthProfileStore): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2));
  }

  /**
   * Get a credential by provider and optional profile ID
   */
  get(provider: string, profileId: string = 'default'): AuthCredential | null {
    const store = this.load();
    return store.profiles[`${provider}:${profileId}`] ?? null;
  }

  /**
   * Get the default credential for a provider
   */
  getDefault(provider: string): AuthCredential | null {
    const store = this.load();

    // Check lastGood first
    const lastGoodId = store.lastGood?.[provider];
    if (lastGoodId) {
      const cred = store.profiles[`${provider}:${lastGoodId}`];
      if (cred) return cred;
    }

    // Fall back to :default
    return store.profiles[`${provider}:default`] ?? null;
  }

  /**
   * Save a credential
   */
  set(provider: string, profileId: string, credential: AuthCredential): void {
    const store = this.load();
    const key = `${provider}:${profileId}`;
    store.profiles[key] = { ...credential, provider, createdAt: Date.now() };

    // Update lastGood
    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    this.save(store);
  }

  /**
   * Save an API key credential
   */
  setApiKey(provider: string, key: string, profileId: string = 'default'): void {
    this.set(provider, profileId, {
      type: 'api_key',
      provider,
      key,
      createdAt: Date.now(),
    });
  }

  /**
   * Remove a credential
   */
  remove(provider: string, profileId: string = 'default'): void {
    const store = this.load();
    delete store.profiles[`${provider}:${profileId}`];

    if (store.lastGood?.[provider] === profileId) {
      delete store.lastGood[provider];
    }

    this.save(store);
  }

  /**
   * List all profiles
   */
  list(): Array<{ id: string; provider: string; profileId: string; type: string; createdAt: number }> {
    const store = this.load();
    return Object.entries(store.profiles).map(([id, cred]) => {
      const [provider, ...rest] = id.split(':');
      return {
        id,
        provider,
        profileId: rest.join(':') || 'default',
        type: cred.type,
        createdAt: cred.createdAt,
      };
    });
  }

  /**
   * Check if any credential exists
   */
  isAuthenticated(): boolean {
    return Object.keys(this.load().profiles).length > 0;
  }

  /**
   * Get provider for a credential
   */
  getProviderCredential(provider: string): { key?: string; token?: string } | null {
    const cred = this.getDefault(provider);
    if (!cred) return null;

    if (cred.type === 'api_key') return { key: cred.key };
    if (cred.type === 'token') return { token: cred.token };
    return null;
  }

  /**
   * Generate a session token for War Room
   */
  createSession(): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    // Store session alongside profiles
    const store = this.load();
    (store as Record<string, unknown>).session = { token, expiresAt };
    this.save(store);

    return { token, expiresAt };
  }

  /**
   * Validate a session token
   */
  validateSession(token: string): boolean {
    const store = this.load();
    const session = (store as Record<string, unknown>).session as { token: string; expiresAt: number } | undefined;
    if (!session) return false;
    return session.token === token && Date.now() < session.expiresAt;
  }
}

// ============================================================================
// Default instance
// ============================================================================

export const auth = new AuthProfileManager();

/**
 * WRAP NEBULA — Auth Module
 * Credential storage, session tokens, provider management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const AUTH_FILE = path.join(os.homedir(), '.nebula', 'auth.json');

// ============================================================================
// Types
// ============================================================================

export interface ApiCredential {
  type: 'api';
  provider: string;
  key: string;
  createdAt: number;
}

export interface OAuthCredential {
  type: 'oauth';
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  createdAt: number;
}

export interface Session {
  token: string;
  createdAt: number;
  expiresAt: number;
}

export type Credential = ApiCredential | OAuthCredential;

export interface AuthStore {
  credentials: Record<string, Credential>;
  session?: Session;
}

// ============================================================================
// Auth Operations
// ============================================================================

export const Auth = {
  all(): AuthStore {
    try {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    } catch {
      return { credentials: {} };
    }
  },

  get(provider: string): Credential | null {
    return this.all().credentials[provider] ?? null;
  },

  set(provider: string, credential: Credential): void {
    const store = this.all();
    store.credentials[provider] = credential;
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
  },

  remove(provider: string): void {
    const store = this.all();
    delete store.credentials[provider];
    fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
  },

  createSession(): Session {
    const session: Session = {
      token: crypto.randomBytes(32).toString('hex'),
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
    const store = this.all();
    store.session = session;
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
    return session;
  },

  validateSession(token: string): boolean {
    const session = this.all().session;
    if (!session) return false;
    if (session.token !== token) return false;
    if (Date.now() > session.expiresAt) return false;
    return true;
  },

  isAuthenticated(): boolean {
    return Object.keys(this.all().credentials).length > 0;
  },

  list(): Array<{ provider: string; type: string; createdAt: number }> {
    return Object.entries(this.all().credentials).map(([provider, cred]) => ({
      provider,
      type: cred.type,
      createdAt: cred.createdAt,
    }));
  },
};

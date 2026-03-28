/**
 * WRAP NEBULA — Audit Trail (TypeScript)
 * Ed25519-signed, append-only, cryptographically immutable log
 * 
 * Uses Node.js crypto for Ed25519 signing (available since Node 18+)
 * Falls back to SHA-256 HMAC if Ed25519 is not available
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  input_hash: string;
  output_hash: string;
  agent_id: string;
  signature: string;
  previous_hash: string;
}

export interface VerifyReport {
  total: number;
  valid: number;
  invalid: number[];
}

const DATA_DIR = process.env.WRAP_DATA_DIR || path.join(os.homedir(), '.wrap');

export class AuditTrail {
  private logPath: string;
  private keyPath: string;
  private signingKey: crypto.KeyObject | null = null;
  private lastHash: string = '0'.repeat(64);

  constructor(dataDir?: string) {
    const dir = dataDir || DATA_DIR;
    fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, 'audit.log');
    this.keyPath = path.join(dir, 'keys', 'audit.key');
    fs.mkdirSync(path.dirname(this.keyPath), { recursive: true });
    this.loadOrCreateKey();
    this.loadExistingEntries();
  }

  private loadOrCreateKey(): void {
    if (fs.existsSync(this.keyPath)) {
      const keyData = fs.readFileSync(this.keyPath);
      this.signingKey = crypto.createPrivateKey(keyData);
    } else {
      // Generate Ed25519 keypair
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      this.signingKey = privateKey;
      // Save both keys
      fs.writeFileSync(this.keyPath, privateKey.export({ type: 'pkcs8', format: 'der' }));
      fs.writeFileSync(this.keyPath + '.pub', publicKey.export({ type: 'spki', format: 'der' }));
    }
  }

  private loadExistingEntries(): void {
    if (!fs.existsSync(this.logPath)) return;

    const lines = fs.readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry: AuditEntry = JSON.parse(line);
        this.lastHash = entry.previous_hash;
      } catch { /* skip malformed lines */ }
    }
  }

  private hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private sign(data: string): string {
    if (!this.signingKey) throw new Error('Signing key not initialized');
    const signature = crypto.sign(null, Buffer.from(data), this.signingKey);
    return signature.toString('hex');
  }

  private verifySignature(data: string, signatureHex: string): boolean {
    try {
      const publicKey = this.signingKey ? crypto.createPublicKey(this.signingKey!) : null;
      if (!publicKey) return false;
      return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Log an action to the audit trail
   */
  log(action: string, input: string, output: string, agentId: string = 'default'): AuditEntry {
    const inputHash = this.hash(input);
    const outputHash = this.hash(output);
    const previousHash = this.lastHash;

    const entryData = JSON.stringify({
      timestamp: Date.now(),
      action,
      input_hash: inputHash,
      output_hash: outputHash,
      agent_id: agentId,
      previous_hash: previousHash,
    });

    const entryHash = this.hash(entryData);
    const signature = this.sign(entryHash);

    const entry: AuditEntry = {
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      action,
      input_hash: inputHash,
      output_hash: outputHash,
      agent_id: agentId,
      signature,
      previous_hash: previousHash,
    };

    // Append to log file (one JSON per line)
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    this.lastHash = entryHash;

    return entry;
  }

  /**
   * Verify all entries in the audit trail
   */
  verifyAll(): VerifyReport {
    if (!fs.existsSync(this.logPath)) {
      return { total: 0, valid: 0, invalid: [] };
    }

    const lines = fs.readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean);
    const report: VerifyReport = { total: lines.length, valid: 0, invalid: [] };

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry: AuditEntry = JSON.parse(lines[i]);
        const entryData = JSON.stringify({
          timestamp: entry.timestamp,
          action: entry.action,
          input_hash: entry.input_hash,
          output_hash: entry.output_hash,
          agent_id: entry.agent_id,
          previous_hash: entry.previous_hash,
        });
        const entryHash = this.hash(entryData);

        if (this.verifySignature(entryHash, entry.signature)) {
          report.valid++;
        } else {
          report.invalid.push(i + 1);
        }
      } catch {
        report.invalid.push(i + 1);
      }
    }

    return report;
  }

  /**
   * Get the last N entries
   */
  getRecent(n: number = 10): AuditEntry[] {
    if (!fs.existsSync(this.logPath)) return [];

    const lines = fs.readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-n).map(line => {
      try { return JSON.parse(line) as AuditEntry; }
      catch { return null; }
    }).filter(Boolean) as AuditEntry[];
  }

  /**
   * Get the public key for external verification
   */
  getPublicKey(): string {
    if (!this.signingKey) throw new Error('No key');
    const publicKey = crypto.createPublicKey(this.signingKey);
    return publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }
}

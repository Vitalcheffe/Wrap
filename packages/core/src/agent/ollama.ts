/**
 * WRAP NEBULA — Ollama Provider
 * Free, local LLM backend via Ollama HTTP API
 */

import * as http from 'http';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  numCtx?: number;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'llama3',
  temperature: 0.7,
  numCtx: 4096,
};

/**
 * Check if Ollama is running and the model is available
 */
export async function checkOllama(config: Partial<OllamaConfig> = {}): Promise<{ running: boolean; modelAvailable: boolean; error?: string }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    // Check if Ollama is running
    const tags = await httpGet(`${cfg.baseUrl}/api/tags`);
    const data = JSON.parse(tags);

    if (!data.models) {
      return { running: false, modelAvailable: false, error: 'Ollama returned unexpected response' };
    }

    // Check if model is available
    const modelAvailable = data.models.some(
      (m: { name: string }) => m.name === cfg.model || m.name.startsWith(cfg.model + ':')
    );

    return { running: true, modelAvailable, error: modelAvailable ? undefined : `Model "${cfg.model}" not found. Run: ollama pull ${cfg.model}` };
  } catch (e: unknown) {
    const err = e as Error;
    return { running: false, modelAvailable: false, error: `Ollama not running: ${err.message}. Start with: ollama serve` };
  }
}

/**
 * Send a chat completion request to Ollama
 */
export async function chat(messages: OllamaMessage[], config: Partial<OllamaConfig> = {}): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const body = JSON.stringify({
    model: cfg.model,
    messages,
    stream: false,
    options: {
      temperature: cfg.temperature,
      num_ctx: cfg.numCtx,
    },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(`${cfg.baseUrl}/api/chat`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as OllamaResponse;
          resolve(parsed.message?.content || '');
        } catch {
          reject(new Error(`Failed to parse Ollama response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Ollama request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama request timed out (60s)')); });
    req.write(body);
    req.end();
  });
}

/**
 * Simple HTTP GET helper
 */
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.get({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

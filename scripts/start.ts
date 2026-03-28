#!/usr/bin/env node
/**
 * WRAP NEBULA v8.0 — Agent Entry Point
 * Connects to Ollama/Claude/GPT and responds to messages
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as readline from 'readline';

// ============================================================================
// Ollama Client (inline to avoid import issues)
// ============================================================================

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

async function ollamaChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    options: { temperature: 0.7, num_ctx: 4096 },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(`${OLLAMA_URL}/api/chat`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || '11434',
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.message?.content || '');
        } catch { reject(new Error(`Failed to parse: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', (e) => reject(new Error(`Ollama error: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout (120s)')); });
    req.write(body);
    req.end();
  });
}

async function checkOllama(): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(`${OLLAMA_URL}/api/tags`);
    const req = http.get({ hostname: url.hostname, port: url.port || '11434', path: url.pathname, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const tags = JSON.parse(data);
          const available = tags.models?.some((m: { name: string }) => m.name.startsWith(OLLAMA_MODEL));
          resolve(!!available);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ============================================================================
// SQLite Memory
// ============================================================================

let db: {
  run: (sql: string, ...params: unknown[]) => void;
  all: (sql: string, ...params: unknown[]) => Array<Record<string, unknown>>;
  get: (sql: string, ...params: unknown[]) => Record<string, unknown> | undefined;
} | null = null;

function initMemory() {
  try {
    // Dynamic import for better-sqlite3
    const Database = require('better-sqlite3');
    const dbPath = path.join(os.homedir(), '.wrap', 'memory', 'conversations.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        due_date INTEGER,
        done INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    `);
    db = {
      run: (sql: string, ...params: unknown[]) => sqlite.prepare(sql).run(...params),
      all: (sql: string, ...params: unknown[]) => sqlite.prepare(sql).all(...params),
      get: (sql: string, ...params: unknown[]) => sqlite.prepare(sql).get(...params),
    };
    return true;
  } catch (e) {
    console.log('  ⚠ SQLite not available, using in-memory storage');
    const memStore: Record<string, Array<{ role: string; content: string; timestamp: number }>> = {};
    db = {
      run: (sql: string, ...params: unknown[]) => {
        if (sql.includes('INSERT INTO messages')) {
          const [sessionId, role, content, timestamp] = params as [string, string, string, number];
          if (!memStore[sessionId]) memStore[sessionId] = [];
          memStore[sessionId].push({ role, content, timestamp });
        }
      },
      all: (sql: string, ...params: unknown[]) => {
        if (sql.includes('SELECT') && sql.includes('messages')) {
          const [sessionId] = params as [string];
          return (memStore[sessionId] || []).slice(-10).reverse();
        }
        return [];
      },
      get: () => undefined,
    };
    return false;
  }
}

// ============================================================================
// SOUL Parser
// ============================================================================

interface SoulConfig {
  name: string;
  personality: string;
  skills: string[];
  rules: string[];
}

function parseSoul(filePath: string): SoulConfig {
  const defaults: SoulConfig = { name: 'NEBULA', personality: 'helpful assistant', skills: [], rules: [] };
  if (!fs.existsSync(filePath)) return defaults;

  const content = fs.readFileSync(filePath, 'utf-8');
  const soul: SoulConfig = { ...defaults };
  let section = '';

  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.toLowerCase().startsWith('name:')) { soul.name = t.slice(5).trim(); continue; }
    if (t.toLowerCase().startsWith('personality:')) { soul.personality = t.slice(12).trim(); continue; }
    if (t.toLowerCase().includes('skills')) { section = 'skills'; continue; }
    if (t.toLowerCase().includes('rules')) { section = 'rules'; continue; }
    if (t.startsWith('- ') || t.startsWith('* ')) {
      const item = t.slice(2).trim();
      if (section === 'skills') soul.skills.push(item);
      if (section === 'rules') soul.rules.push(item);
    }
  }
  return soul;
}

// ============================================================================
// Input Sanitizer
// ============================================================================

const INJECTION_PATTERNS = [
  /ignore previous instructions/i,
  /forget everything above/i,
  /you are now/i,
  /act as if you are/i,
  /jailbreak/i,
  /DAN mode/i,
  /pretend you are/i,
  /disregard your/i,
  /new instructions:/i,
  /system prompt:/i,
];

function sanitizeInput(input: string): { safe: boolean; reason?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { safe: false, reason: `Blocked: matches injection pattern ${pattern}` };
    }
  }
  return { safe: true };
}

// ============================================================================
// Message Processing
// ============================================================================

async function processMessage(sessionId: string, userMessage: string, soul: SoulConfig, systemPrompt: string): Promise<string> {
  // Sanitize
  const { safe, reason } = sanitizeInput(userMessage);
  if (!safe) {
    return `⚠️ Request blocked: ${reason}`;
  }

  // Save user message
  if (db) {
    try { db.run('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)', sessionId, 'user', userMessage, Date.now()); } catch { /* ignore */ }
  }

  // Load history
  let history: Array<{ role: string; content: string }> = [];
  if (db) {
    try { history = db.all('SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 10', sessionId) as Array<{ role: string; content: string }>; } catch { /* ignore */ }
  }

  // Build messages
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.reverse().map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  // Call LLM
  const reply = await ollamaChat(messages);

  // Save assistant reply
  if (db) {
    try { db.run('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)', sessionId, 'assistant', reply, Date.now()); } catch { /* ignore */ }
  }

  return reply;
}

// ============================================================================
// HTTP API for War Room
// ============================================================================

function startAPI(soul: SoulConfig) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/api/status') {
      res.end(JSON.stringify({ online: true, model: OLLAMA_MODEL, agent: soul.name, memory: !!db }));
    } else if (req.url?.startsWith('/api/messages')) {
      if (db) {
        const msgs = db.all('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 20');
        res.end(JSON.stringify(msgs));
      } else {
        res.end(JSON.stringify([]));
      }
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  const port = parseInt(process.env.CORE_PORT || '3001', 10);
  server.listen(port, () => {
    console.log(`  ✓ Core API running on http://localhost:${port}`);
  });
}

// ============================================================================
// Telegram Bot
// ============================================================================

function startTelegram(soul: SoulConfig, systemPrompt: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    const { Telegraf } = require('telegraf');
    const bot = new Telegraf(token);

    bot.command('start', (ctx: { reply: (msg: string) => void }) => {
      ctx.reply(`Hello! I'm ${soul.name}. ${soul.personality}. How can I help?`);
    });

    bot.command('help', (ctx: { reply: (msg: string) => void }) => {
      const skills = soul.skills.length ? soul.skills.map(s => `• ${s}`).join('\n') : 'No skills configured';
      ctx.reply(`${soul.name} Skills:\n${skills}\n\nCommands: /start /help /status /reset`);
    });

    bot.command('status', (ctx: { reply: (msg: string) => void }) => {
      ctx.reply(`Status: 🟢 Online\nModel: ${OLLAMA_MODEL}\nAgent: ${soul.name}\nMemory: ${db ? 'SQLite' : 'In-memory'}`);
    });

    bot.command('reset', (ctx: { reply: (msg: string) => void; from: { id: number } }) => {
      const sessionId = String(ctx.from?.id || 'default');
      if (db) {
        try { db.run('DELETE FROM messages WHERE session_id = ?', sessionId); } catch { /* ignore */ }
      }
      ctx.reply('Memory cleared. Fresh start! 🧹');
    });

    bot.on('text', async (ctx: { message: { text: string }; from: { id: number }; reply: (msg: string) => Promise<void>; sendChatAction: (action: string) => Promise<void> }) => {
      const sessionId = String(ctx.from?.id || 'default');
      const userMessage = ctx.message.text;

      await ctx.sendChatAction('typing');

      try {
        const reply = await processMessage(sessionId, userMessage, soul, systemPrompt);
        // Split long messages
        if (reply.length > 4096) {
          for (let i = 0; i < reply.length; i += 4096) {
            await ctx.reply(reply.slice(i, i + 4096));
          }
        } else {
          await ctx.reply(reply);
        }
      } catch (err: unknown) {
        const error = err as Error;
        console.error('Telegram error:', error.message);
        await ctx.reply("I'm having trouble thinking right now. Try again in a moment.");
      }
    });

    bot.launch().then(() => {
      console.log(`  ✓ Telegram bot connected`);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (e) {
    console.log('  ⚠ Telegram: telegraf not installed. Run: npm install telegraf');
  }
}

// ============================================================================
// Interactive Mode
// ============================================================================

async function startInteractive(soul: SoulConfig, systemPrompt: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n${soul.name} is ready. Type your message (or /quit to exit, /reset to clear memory).\n`);

  const ask = () => {
    rl.question('You: ', async (input) => {
      if (input.trim() === '/quit') {
        console.log(`\n${soul.name}: Goodbye! 👋`);
        rl.close();
        return;
      }
      if (input.trim() === '/reset') {
        if (db) {
          try { db.run('DELETE FROM messages WHERE session_id = ?', 'interactive'); } catch { /* ignore */ }
        }
        console.log(`${soul.name}: Memory cleared. 🧹\n`);
        ask();
        return;
      }
      if (!input.trim()) { ask(); return; }

      try {
        const reply = await processMessage('interactive', input, soul, systemPrompt);
        console.log(`\n${soul.name}: ${reply}\n`);
      } catch (e: unknown) {
        const err = e as Error;
        console.log(`\n[Error] ${err.message}\n`);
      }

      ask();
    });
  };

  ask();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const WRAP_DIR = process.cwd();
  const SOUL_PATH = path.join(WRAP_DIR, 'skills/default/SOUL.md');
  const ENV_PATH = path.join(WRAP_DIR, '.env');

  // Load .env
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }

  // Load SOUL
  const soul = parseSoul(SOUL_PATH);

  // Build system prompt
  const systemPrompt = [
    `You are ${soul.name}. ${soul.personality}.`,
    soul.skills.length ? `Your available skills: ${soul.skills.join(', ')}.` : '',
    soul.rules.length ? `Rules:\n${soul.rules.map(r => `- ${r}`).join('\n')}` : '',
    'Be concise. Be helpful. Be direct. Answer in the same language the user speaks.',
  ].filter(Boolean).join('\n\n');

  console.log(`
 ██╗    ██╗██████╗  █████╗ ██████╗
 ██║    ██║██╔══██╗██╔══██╗██╔══██╗
 ██║ █╗ ██║██████╔╝███████║██████╔╝
 ██║███╗██║██╔══██╗██╔══██║██╔═══╝
 ╚███╔███╔╝██║  ██║██║  ██║██║
  ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝

 NEBULA v8.0 by VitalCheffe
 github.com/Vitalcheffe/Wrap
`);

  console.log(`  [✓] SOUL loaded: ${soul.name}`);

  // Check Ollama
  process.stdout.write('  [...] Connecting to Ollama...');
  const ollamaOk = await checkOllama();
  if (ollamaOk) {
    console.log(` ✓ ${OLLAMA_MODEL}`);
  } else {
    console.log(' ✗');
    console.log(`\n  Ollama not running or model "${OLLAMA_MODEL}" not found.`);
    console.log('  1. Install: curl -fsSL https://ollama.com/install.sh | sh');
    console.log(`  2. Pull model: ollama pull ${OLLAMA_MODEL}`);
    console.log('  3. Start Ollama: ollama serve\n');
    process.exit(1);
  }

  // Init memory
  initMemory();
  console.log(`  [✓] Memory initialized (${db ? 'SQLite' : 'in-memory'})`);

  // Start API
  startAPI(soul);

  // Start Telegram
  startTelegram(soul, systemPrompt);

  console.log(`
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ${soul.name} is live. Say hello!
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);

  // Interactive mode (if no Telegram)
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    await startInteractive(soul, systemPrompt);
  } else {
    // Keep process alive
    await new Promise(() => {}); // never resolves
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

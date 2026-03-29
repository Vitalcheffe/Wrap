#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as readline from 'readline';

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

// Load config
let config: Record<string, unknown> = {};
const configPath = path.join(os.homedir(), '.nebula', 'config.yaml');
if (fs.existsSync(configPath)) {
  try {
    const yaml = require('yaml');
    config = yaml.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch { /* use defaults */ }
}

// Load SOUL
let soul = { name: (config.agent as any)?.name || 'Aria', personality: 'helpful assistant', skills: [] as string[], rules: [] as string[] };
const soulPath = path.join(os.homedir(), '.nebula', 'SOUL.md');
if (fs.existsSync(soulPath)) {
  const content = fs.readFileSync(soulPath, 'utf-8');
  let section = '';
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.toLowerCase().startsWith('name:')) soul.name = t.slice(5).trim();
    if (t.toLowerCase().startsWith('personality:')) soul.personality = t.slice(12).trim();
    if (t.toLowerCase().includes('skills')) section = 'skills';
    if (t.toLowerCase().includes('rules')) section = 'rules';
    if (t.startsWith('- ') || t.startsWith('* ')) {
      const item = t.slice(2).trim();
      if (section === 'skills') soul.skills.push(item);
      if (section === 'rules') soul.rules.push(item);
    }
  }
}

const systemPrompt = [
  `You are ${soul.name}. ${soul.personality}.`,
  soul.skills.length ? `Your skills: ${soul.skills.join(', ')}.` : '',
  soul.rules.length ? `Rules:\n${soul.rules.map(r => '- ' + r).join('\n')}` : '',
  'Be concise. Be helpful. Answer in the same language the user speaks.',
].filter(Boolean).join('\n\n');

async function ollamaChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  const body = JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false, options: { temperature: 0.7 } });
  return new Promise((resolve, reject) => {
    const url = new URL(`${OLLAMA_URL}/api/chat`);
    const req = http.request({
      hostname: url.hostname, port: url.port || '11434', path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data).message?.content || ''); }
        catch { reject(new Error('Failed to parse response')); }
      });
    });
    req.on('error', (e) => {
      if (e.message.includes('ECONNREFUSED')) reject(new Error('Ollama not running. Start with: ollama serve'));
      else reject(new Error(`Connection error: ${e.message}`));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (120s)')); });
    req.write(body); req.end();
  });
}

// Memory (simple file-based)
const memPath = path.join(os.homedir(), '.nebula', 'memory.json');
let memory: Array<{ role: string; content: string; ts: number }> = [];
if (fs.existsSync(memPath)) {
  try { memory = JSON.parse(fs.readFileSync(memPath, 'utf-8')); } catch { memory = []; }
}
function saveMemory() { fs.writeFileSync(memPath, JSON.stringify(memory.slice(-100))); }

async function main() {
  console.log('\n ██╗    ██╗██████╗  █████╗ ██████╗');
  console.log(' ██║    ██║██╔══██╗██╔══██╗██╔══██╗');
  console.log(' ██║ █╗ ██║██████╔╝███████║██████╔╝');
  console.log(' ██║███╗██║██╔══██╗██╔══██║██╔═══╝');
  console.log(' ╚███╔███╔╝██║  ██║██║  ██║██║');
  console.log('  ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝\n');
  console.log(' NEBULA v8.0 by VitalCheffe\n');

  // Check Ollama
  process.stdout.write('  [...] Connecting to Ollama...');
  const ok = await new Promise<boolean>((resolve) => {
    http.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 }, (res) => {
      let d = ''; res.on('data', (c: Buffer) => { d += c.toString(); });
      res.on('end', () => {
        try {
          const tags = JSON.parse(d);
          resolve(tags.models?.some((m: any) => m.name.startsWith(OLLAMA_MODEL)));
        } catch { resolve(false); }
      });
    }).on('error', () => resolve(false)).on('timeout', function() { (this as any).destroy(); resolve(false); });
  });

  if (!ok) {
    console.log(' ✗');
    console.log(`\n  ❌ Ollama not running or model "${OLLAMA_MODEL}" not found.`);
    console.log('  Fix: ollama serve && ollama pull ' + OLLAMA_MODEL + '\n');
    process.exit(1);
  }
  console.log(` ✓ ${OLLAMA_MODEL}`);
  console.log(`  [✓] ${soul.name} loaded`);
  console.log(`  [✓] Memory initialized\n`);

  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   ${soul.name} is ready. Say hello!`);
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => {
    rl.question('You: ', async (input) => {
      if (input.trim() === '/quit') { console.log(`\n${soul.name}: Goodbye! 👋`); rl.close(); return; }
      if (input.trim() === '/reset') { memory = []; saveMemory(); console.log(`${soul.name}: Memory cleared. 🧹\n`); ask(); return; }
      if (!input.trim()) { ask(); return; }

      memory.push({ role: 'user', content: input, ts: Date.now() });
      const ctx = [{ role: 'system', content: systemPrompt }, ...memory.slice(-10).map(m => ({ role: m.role, content: m.content }))];

      try {
        const reply = await ollamaChat(ctx);
        memory.push({ role: 'assistant', content: reply, ts: Date.now() });
        saveMemory();
        console.log(`\n${soul.name}: ${reply}\n`);
      } catch (e: any) {
        console.log(`\n[Error] ${e.message}\n`);
      }
      ask();
    });
  };
  ask();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

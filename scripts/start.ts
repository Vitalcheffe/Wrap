#!/usr/bin/env node
/**
 * WRAP NEBULA — Quick Start
 * A minimal working agent that connects to Ollama and responds to messages
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { chat, checkOllama } from './agent/ollama';

const SOUL_PATH = path.join(process.cwd(), 'skills/default/SOUL.md');

function parseSoul(content: string): { name: string; personality: string; skills: string[]; rules: string[] } {
  const lines = content.split('\n');
  const soul: Record<string, string | string[]> = { name: 'NEBULA', personality: '', skills: [], rules: [] };
  let section = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith('name:')) { soul.name = trimmed.slice(5).trim(); continue; }
    if (trimmed.toLowerCase().startsWith('personality:')) { soul.personality = trimmed.slice(12).trim(); continue; }
    if (trimmed.toLowerCase().includes('skills')) { section = 'skills'; continue; }
    if (trimmed.toLowerCase().includes('rules')) { section = 'rules'; continue; }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const item = trimmed.slice(2).trim();
      if (section === 'skills') (soul.skills as string[]).push(item);
      if (section === 'rules') (soul.rules as string[]).push(item);
    }
  }
  return soul as unknown as { name: string; personality: string; skills: string[]; rules: string[] };
}

async function main() {
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

  // Load SOUL
  let soul = { name: 'NEBULA', personality: 'helpful assistant', skills: [] as string[], rules: [] as string[] };
  if (fs.existsSync(SOUL_PATH)) {
    const content = fs.readFileSync(SOUL_PATH, 'utf-8');
    soul = parseSoul(content);
    console.log(`[✓] SOUL loaded: ${soul.name}`);
  } else {
    console.log('[!] No SOUL.md found, using defaults');
  }

  // Check Ollama
  console.log('[...] Checking Ollama...');
  const status = await checkOllama();
  if (!status.running) {
    console.log(`[✗] ${status.error}`);
    console.log('\nTo use WRAP with Ollama:');
    console.log('  1. Install: curl -fsSL https://ollama.com/install.sh | sh');
    console.log('  2. Pull a model: ollama pull llama3');
    console.log('  3. Start Ollama: ollama serve');
    console.log('  4. Run this script again\n');
    process.exit(1);
  }
  if (!status.modelAvailable) {
    console.log(`[✗] ${status.error}`);
    process.exit(1);
  }
  console.log('[✓] Ollama connected');

  // Build system prompt
  const systemPrompt = [
    `You are ${soul.name}, ${soul.personality}.`,
    soul.skills.length ? `Your skills: ${soul.skills.join(', ')}.` : '',
    soul.rules.length ? `Rules:\n${soul.rules.map(r => `- ${r}`).join('\n')}` : '',
    'Be concise. Be helpful. Be direct.',
  ].filter(Boolean).join('\n\n');

  // Interactive loop
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const history: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ];

  console.log(`\n${soul.name} is ready. Type your message (or /quit to exit).\n`);

  const ask = () => {
    rl.question('You: ', async (input) => {
      if (input.trim() === '/quit') {
        console.log(`\n${soul.name}: Goodbye! 👋`);
        rl.close();
        return;
      }
      if (!input.trim()) { ask(); return; }

      history.push({ role: 'user', content: input });

      try {
        // Keep last 10 messages + system prompt
        const context = [history[0], ...history.slice(-10)];
        const response = await chat(context);
        history.push({ role: 'assistant', content: response });
        console.log(`\n${soul.name}: ${response}\n`);
      } catch (e: unknown) {
        const err = e as Error;
        console.log(`\n[Error] ${err.message}\n`);
      }

      ask();
    });
  };

  ask();
}

main().catch(console.error);

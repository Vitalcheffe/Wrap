/**
 * WRAP NEBULA VS Code — Chat Panel
 * Webview-based chat interface
 */

import * as vscode from 'vscode';
import { WrapClient } from './wrapClient';

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'wrap-nebula.chat';

  private view?: vscode.WebviewView;
  private client: WrapClient;
  private extensionUri: vscode.Uri;
  private pendingMessage?: string;

  constructor(extensionUri: vscode.Uri, client: WrapClient) {
    this.extensionUri = extensionUri;
    this.client = client;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this.handleUserMessage(data.message);
          break;
        case 'ready':
          if (this.pendingMessage) {
            webviewView.webview.postMessage({ type: 'autoSend', message: this.pendingMessage });
            this.pendingMessage = undefined;
          }
          break;
      }
    });

    // Send pending message if any
    if (this.pendingMessage) {
      webviewView.webview.postMessage({ type: 'autoSend', message: this.pendingMessage });
      this.pendingMessage = undefined;
    }
  }

  public async sendMessage(message: string) {
    if (this.view) {
      this.view.webview.postMessage({ type: 'autoSend', message });
    } else {
      this.pendingMessage = message;
      await vscode.commands.executeCommand('wrap-nebula.chat.focus');
    }
  }

  private async handleUserMessage(message: string) {
    if (!this.view) return;

    // Show typing indicator
    this.view.webview.postMessage({ type: 'typing' });

    try {
      const reply = await this.client.sendMessage('vscode', message);
      this.view.webview.postMessage({ type: 'reply', message: reply });
    } catch (e: unknown) {
      const err = e as Error;
      this.view.webview.postMessage({ type: 'error', message: err.message });
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: bold;
    }
    .header .shield { color: var(--vscode-charts-green); }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 90%;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .message.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .message.assistant {
      align-self: flex-start;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .message.error {
      align-self: flex-start;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    .message.system {
      align-self: center;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 0.85em;
      opacity: 0.8;
    }
    .typing {
      align-self: flex-start;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .input-area {
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 8px;
    }
    .input-area textarea {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px;
      resize: none;
      font-family: inherit;
      font-size: inherit;
      min-height: 36px;
      max-height: 120px;
    }
    .input-area textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .input-area button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font-family: inherit;
    }
    .input-area button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 24px;
    }
    .empty-state h3 { margin-bottom: 8px; }
    .empty-state p { font-size: 0.9em; opacity: 0.7; }
    code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 4px 0;
    }
    pre code { background: none; padding: 0; }
  </style>
</head>
<body>
  <div class="header">
    <span class="shield">🛡️</span>
    <span>WRAP NEBULA</span>
  </div>
  <div class="messages" id="messages">
    <div class="empty-state">
      <h3>🛡️ WRAP NEBULA</h3>
      <p>Zero-trust AI agent</p>
      <p style="margin-top: 12px;">Type a message to start chatting</p>
      <p style="margin-top: 8px; font-size: 0.8em;">Your code stays local. Every action is audited.</p>
    </div>
  </div>
  <div class="input-area">
    <textarea id="input" placeholder="Ask WRAP anything..." rows="1"></textarea>
    <button id="send" onclick="send()">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    let hasMessages = false;

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      addMessage('user', text);
      vscode.postMessage({ type: 'sendMessage', message: text });
      inputEl.value = '';
      inputEl.style.height = 'auto';
    }

    function addMessage(role, content) {
      if (!hasMessages) {
        messagesEl.innerHTML = '';
        hasMessages = true;
      }
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = content;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      if (!hasMessages) {
        messagesEl.innerHTML = '';
        hasMessages = true;
      }
      const existing = document.querySelector('.typing');
      if (existing) existing.remove();
      const div = document.createElement('div');
      div.className = 'message typing';
      div.textContent = 'Thinking...';
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
      const typing = document.querySelector('.typing');
      if (typing) typing.remove();
    }

    window.addEventListener('message', (event) => {
      const data = event.data;
      switch (data.type) {
        case 'reply':
          removeTyping();
          addMessage('assistant', data.message);
          break;
        case 'error':
          removeTyping();
          addMessage('error', 'Error: ' + data.message);
          break;
        case 'typing':
          showTyping();
          break;
        case 'autoSend':
          addMessage('user', data.message);
          vscode.postMessage({ type: 'sendMessage', message: data.message });
          break;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

/**
 * WRAP NEBULA VS Code Extension
 * Entry point — registers commands and views
 */

import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { WrapClient } from './wrapClient';
import { AuditTreeProvider } from './auditTree';

let wrapClient: WrapClient | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('WRAP NEBULA extension activated');

  const config = vscode.workspace.getConfiguration('wrap-nebula');
  const apiUrl = config.get<string>('apiUrl', 'http://localhost:3001');

  wrapClient = new WrapClient(apiUrl);

  // Register chat panel provider
  const chatProvider = new ChatPanel(context.extensionUri, wrapClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('wrap-nebula.chat', chatProvider)
  );

  // Register audit tree provider
  const auditProvider = new AuditTreeProvider(wrapClient);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('wrap-nebula.audit', auditProvider)
  );

  // Command: Start Agent
  context.subscriptions.push(
    vscode.commands.registerCommand('wrap-nebula.start', async () => {
      const status = await wrapClient?.checkStatus();
      if (status?.online) {
        vscode.window.showInformationMessage(`WRAP NEBULA: Agent "${status.agent}" is already running`);
      } else {
        vscode.window.showWarningMessage('WRAP NEBULA: Agent not running. Start it with: nebula start');
      }
    })
  );

  // Command: Open Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('wrap-nebula.openChat', () => {
      vscode.commands.executeCommand('wrap-nebula.chat.focus');
    })
  );

  // Command: Configure
  context.subscriptions.push(
    vscode.commands.registerCommand('wrap-nebula.configure', async () => {
      const apiUrl = await vscode.window.showInputBox({
        prompt: 'Enter WRAP Core API URL',
        value: config.get<string>('apiUrl', 'http://localhost:3001'),
      });
      if (apiUrl) {
        await config.update('apiUrl', apiUrl, vscode.ConfigurationTarget.Global);
        wrapClient = new WrapClient(apiUrl);
        vscode.window.showInformationMessage(`WRAP NEBULA: API URL updated to ${apiUrl}`);
      }
    })
  );

  // Command: Explain Code
  context.subscriptions.push(
    vscode.commands.registerCommand('wrap-nebula.explainCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.selection;
      const code = editor.document.getText(selection);
      if (!code) {
        vscode.window.showWarningMessage('Select some code first');
        return;
      }
      const language = editor.document.languageId;
      const prompt = `Explain this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``;
      await chatProvider.sendMessage(prompt);
      vscode.commands.executeCommand('wrap-nebula.chat.focus');
    })
  );

  // Command: Fix Code
  context.subscriptions.push(
    vscode.commands.registerCommand('wrap-nebula.fixCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.selection;
      const code = editor.document.getText(selection);
      if (!code) {
        vscode.window.showWarningMessage('Select some code first');
        return;
      }
      const language = editor.document.languageId;
      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      const errors = diagnostics
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
        .map(d => `- Line ${d.range.start.line + 1}: ${d.message}`)
        .join('\n');

      const prompt = `Fix this ${language} code${errors ? ' (errors found)' : ''}:\n\n\`\`\`${language}\n${code}\n\`\`\`${errors ? `\n\nErrors:\n${errors}` : ''}`;
      await chatProvider.sendMessage(prompt);
      vscode.commands.executeCommand('wrap-nebula.chat.focus');
    })
  );

  // Command: Review Code
  context.subscriptions.push(
    vscode.commands.registerCommand('wrap-nebula.reviewCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.selection;
      const code = editor.document.getText(selection);
      if (!code) {
        vscode.window.showWarningMessage('Select some code first');
        return;
      }
      const language = editor.document.languageId;
      const prompt = `Review this ${language} code for issues, security vulnerabilities, and improvements:\n\n\`\`\`${language}\n${code}\n\`\`\``;
      await chatProvider.sendMessage(prompt);
      vscode.commands.executeCommand('wrap-nebula.chat.focus');
    })
  );

  // Status bar
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(shield) WRAP';
  statusBarItem.tooltip = 'WRAP NEBULA Agent';
  statusBarItem.command = 'wrap-nebula.openChat';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Check status on activation
  wrapClient.checkStatus().then(status => {
    if (status?.online) {
      statusBarItem.text = `$(shield) WRAP: ${status.agent}`;
      statusBarItem.backgroundColor = undefined;
    } else {
      statusBarItem.text = '$(shield) WRAP: offline';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }).catch(() => {
    statusBarItem.text = '$(shield) WRAP: offline';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  });
}

export function deactivate() {
  console.log('WRAP NEBULA extension deactivated');
}

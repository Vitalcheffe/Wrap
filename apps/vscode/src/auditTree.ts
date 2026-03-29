/**
 * WRAP NEBULA VS Code — Audit Trail Tree View
 */

import * as vscode from 'vscode';
import { WrapClient, AuditEntry } from './wrapClient';

export class AuditTreeProvider implements vscode.TreeDataProvider<AuditTreeItem> {
  private client: WrapClient;
  private _onDidChangeTreeData = new vscode.EventEmitter<AuditTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(client: WrapClient) {
    this.client = client;
    // Refresh every 10 seconds
    setInterval(() => this.refresh(), 10000);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AuditTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AuditTreeItem): Promise<AuditTreeItem[]> {
    if (element) return []; // No nested items

    try {
      const entries = await this.client.getAuditTrail();
      if (entries.length === 0) {
        return [new AuditTreeItem('No audit entries yet', '', vscode.TreeItemCollapsibleState.None, 'info')];
      }

      return entries.slice(-20).reverse().map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const icon = entry.action.includes('BLOCKED') ? 'error' : 
                     entry.action.includes('LLM') ? 'comment' : 'check';
        return new AuditTreeItem(
          `${entry.action}`,
          `${time} · ${entry.agent_id}`,
          vscode.TreeItemCollapsibleState.None,
          icon
        );
      });
    } catch {
      return [new AuditTreeItem('Cannot connect to agent', 'Is nebula start running?', vscode.TreeItemCollapsibleState.None, 'warning')];
    }
  }
}

class AuditTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    icon: string
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

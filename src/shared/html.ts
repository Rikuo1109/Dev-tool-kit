import * as vscode from "vscode";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isDarkTheme(): boolean {
  return vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;
}

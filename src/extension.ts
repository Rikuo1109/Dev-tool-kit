import * as vscode from 'vscode';
import { registerCommands } from './commands';

export const activate = (context: vscode.ExtensionContext): void => {
    registerCommands(context);
};

export const deactivate = (): void => {};

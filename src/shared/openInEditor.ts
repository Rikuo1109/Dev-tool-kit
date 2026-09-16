import * as vscode from 'vscode';

export async function openFileInEditor(filePath: string, line = 0, column = 0): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));

    const options: vscode.TextDocumentShowOptions = { preview: true };

    if (line > 0) {
        const position = new vscode.Position(
            Math.min(line - 1, document.lineCount - 1),
            Math.max(0, column),
        );
        options.selection = new vscode.Range(position, position);
    }

    await vscode.window.showTextDocument(document, options);
}

export function bindWebviewOpenHandler(webview: vscode.Webview): vscode.Disposable {
    return webview.onDidReceiveMessage(async (message) => {
        if (message.type !== 'open' || typeof message.path !== 'string') {
            return;
        }

        const line = typeof message.line === 'number' && message.line > 0 ? message.line : 0;
        const column =
            typeof message.column === 'number' && message.column > 0 ? message.column : 0;

        await openFileInEditor(message.path, line, column);
    });
}

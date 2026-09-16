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

import * as vscode from "vscode";

export async function resolveFolderUri(
  uri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  if (uri) {
    return uri;
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showWarningMessage("Open a workspace folder first.");
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0].uri;
  }

  const pick = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: "Select workspace folder" },
  );

  return pick?.folder.uri;
}

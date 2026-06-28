import * as vscode from "vscode";
import { EXCLUDE_GLOB, SOURCE_GLOB } from "../../shared/constants";
import { isDarkTheme } from "../../shared/html";
import {
  FileOrganizeResult,
  OrganizeImportsPanel,
  OrganizeReport,
} from "./panel";

const ORGANIZE_KIND = vscode.CodeActionKind.SourceOrganizeImports.value;
const REMOVE_UNUSED_KIND = vscode.CodeActionKind.Source.append(
  "removeUnusedImports",
).value;
const SORT_KIND = vscode.CodeActionKind.Source.append("sortImports").value;

export async function organizeImportsInFolder(
  folderUri: vscode.Uri,
): Promise<void> {
  const folderPath = folderUri.fsPath.replace(/\\/g, "/").replace(/\/$/, "");
  const folderName = folderPath.split(/[/\\]/).pop() ?? folderPath;
  const pattern = new vscode.RelativePattern(folderUri, SOURCE_GLOB);
  const files = await vscode.workspace.findFiles(pattern, EXCLUDE_GLOB);

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      `No supported source files found in ${folderName}.`,
    );
    return;
  }

  const isDark = isDarkTheme();
  const panel = OrganizeImportsPanel.open(folderName, files.length, isDark);
  const startedAt = Date.now();

  const fileResults: FileOrganizeResult[] = [];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let cancelled = false;

  try {
    for (let i = 0; i < files.length; i++) {
      if (panel.token.isCancellationRequested) {
        cancelled = true;
        break;
      }

      const file = files[i];
      const relativePath = toRelativePath(file.fsPath, folderPath);

      panel.onProgress({
        current: i + 1,
        total: files.length,
        file: relativePath,
        updated,
        unchanged,
        failed,
      });

      try {
        const changed = await organizeImportsInFile(file);
        if (changed) {
          updated++;
          fileResults.push({
            relativePath,
            absolutePath: file.fsPath,
            status: "updated",
          });
        } else {
          unchanged++;
          fileResults.push({
            relativePath,
            absolutePath: file.fsPath,
            status: "unchanged",
          });
        }
      } catch (error) {
        failed++;
        fileResults.push({
          relativePath,
          absolutePath: file.fsPath,
          status: "failed",
          error: formatError(error),
        });
      }
    }
  } finally {
    const report: OrganizeReport = {
      folderName,
      total: files.length,
      updated,
      unchanged,
      failed,
      cancelled,
      files: fileResults,
      durationMs: Date.now() - startedAt,
      errorSummary: buildErrorSummary(fileResults),
    };

    panel.onComplete(report);

    if (failed > 0) {
      vscode.window.showWarningMessage(
        `Organize imports finished with ${failed} error(s). See panel for details.`,
      );
    } else if (cancelled) {
      vscode.window.showInformationMessage(
        `Organize imports cancelled. ${updated} file(s) updated.`,
      );
    }
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildErrorSummary(
  files: FileOrganizeResult[],
): { message: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    if (file.status !== "failed" || !file.error) {
      continue;
    }
    counts.set(file.error, (counts.get(file.error) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count);
}

function toRelativePath(filePath: string, folderPath: string): string {
  const normalizedFile = filePath.replace(/\\/g, "/");
  const normalizedFolder = folderPath.replace(/\\/g, "/");
  return (
    normalizedFile.replace(`${normalizedFolder}/`, "") ||
    normalizedFile.split("/").pop() ||
    normalizedFile
  );
}

async function organizeImportsInFile(uri: vscode.Uri): Promise<boolean> {
  const document = await vscode.workspace.openTextDocument(uri);
  const before = document.getText();

  const editor = await vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: true,
  });

  if (editor.document.uri.toString() !== uri.toString()) {
    throw new Error("Could not open file in editor for organize imports");
  }

  await applySourceAction(ORGANIZE_KIND);

  if (editor.document.getText() === before) {
    await applySourceAction(REMOVE_UNUSED_KIND);
    await applySourceAction(SORT_KIND);
  }

  const after = editor.document.getText();
  if (editor.document.isDirty) {
    await editor.document.save();
  }

  return after !== before;
}

async function applySourceAction(kind: string): Promise<void> {
  try {
    await vscode.commands.executeCommand("editor.action.sourceAction", {
      kind,
      apply: "first",
    });
  } catch {
    // Kind may be unavailable for this file type.
  }
}

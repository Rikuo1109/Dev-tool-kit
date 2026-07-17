import * as path from "path";
import * as vscode from "vscode";
import { EXCLUDE_GLOB } from "../../shared/constants";
import {
  ImportIndex,
  isPathInsideFolder,
  normalizePath,
} from "../../shared/javascript/importGraph";
import {
  extractApiHandlers,
  extractClientApiRefs,
  extractCssClasses,
  extractPathRefs,
  fileToApiPath,
  fileToRoutePath,
  pathReferenced,
} from "./extract";
import { DeadItem } from "./types";

export {
  extractApiHandlers,
  extractClientApiRefs,
  extractCssClasses,
  extractPathRefs,
  fileToApiPath,
  fileToRoutePath,
  pathReferenced,
  selfCheckDeadHeuristics,
} from "./extract";

export async function findDeadRoutes(
  folderPath: string,
  index: ImportIndex,
): Promise<DeadItem[]> {
  const refs = new Set<string>();
  for (const filePath of index.files) {
    for (const ref of extractPathRefs(index.getContent(filePath))) {
      refs.add(ref);
    }
  }

  const items: DeadItem[] = [];
  const seen = new Set<string>();

  for (const filePath of index.files) {
    if (!isPathInsideFolder(filePath, folderPath)) {
      continue;
    }
    // Next route.ts is API, not page route
    if (/\/route\.(tsx?|jsx?)$/i.test(filePath)) {
      continue;
    }
    const relativePath = index.relativePath(filePath);
    const routePath = fileToRoutePath(relativePath);
    if (!routePath || routePath === "/") {
      continue;
    }
    const key = `${filePath}:${routePath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (pathReferenced(routePath, refs)) {
      continue;
    }
    items.push({
      relativePath,
      absolutePath: filePath,
      name: routePath,
      detail: "No href/router/redirect refs found",
    });
  }

  return items.sort(
    (a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "") ||
      a.relativePath.localeCompare(b.relativePath),
  );
}

export async function findDeadApis(
  folderPath: string,
  index: ImportIndex,
): Promise<DeadItem[]> {
  const clientRefs = new Set<string>();
  for (const filePath of index.files) {
    for (const ref of extractClientApiRefs(index.getContent(filePath))) {
      clientRefs.add(ref);
    }
  }

  const items: DeadItem[] = [];
  const seen = new Set<string>();

  for (const filePath of index.files) {
    if (!isPathInsideFolder(filePath, folderPath)) {
      continue;
    }
    const relativePath = index.relativePath(filePath);
    const fileApi = fileToApiPath(relativePath);
    if (fileApi && !seen.has(`${filePath}:${fileApi}`)) {
      seen.add(`${filePath}:${fileApi}`);
      if (!pathReferenced(fileApi, clientRefs)) {
        items.push({
          relativePath,
          absolutePath: filePath,
          name: fileApi,
          detail: "Route handler file — no client fetch/axios refs",
        });
      }
    }

    const content = index.getContent(filePath);
    for (const handler of extractApiHandlers(content)) {
      const key = `${filePath}:${handler.path}:${handler.line}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (pathReferenced(handler.path, clientRefs)) {
        continue;
      }
      items.push({
        relativePath,
        absolutePath: filePath,
        name: handler.path,
        line: handler.line,
        detail: "Handler path — no client fetch/axios refs",
      });
    }
  }

  return items.sort(
    (a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "") ||
      a.relativePath.localeCompare(b.relativePath),
  );
}

export async function findDeadCss(
  folderUri: vscode.Uri,
  folderPath: string,
  index: ImportIndex,
): Promise<DeadItem[]> {
  const cssUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folderUri, "**/*.{css,scss}"),
    EXCLUDE_GLOB,
  );

  const sourceCorpus = index.files
    .filter((filePath) => !/\.(css|scss)$/i.test(filePath))
    .map((filePath) => index.getContent(filePath))
    .join("\n");

  const items: DeadItem[] = [];

  for (const uri of cssUris) {
    const absolutePath = normalizePath(uri.fsPath);
    if (!isPathInsideFolder(absolutePath, folderPath)) {
      continue;
    }
    let content: string;
    try {
      content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(
        "utf-8",
      );
    } catch {
      continue;
    }

    const relativePath = path
      .relative(index.workspaceRoot, absolutePath)
      .replace(/\\/g, "/");

    for (const cls of extractCssClasses(content)) {
      // ponytail: ceiling — CSS modules / dynamic classNames false-positive; upgrade: css-module export map
      const re = new RegExp(
        `(?:^|[^\\w-])${escapeRegExp(cls.name)}(?:$|[^\\w-])`,
      );
      if (re.test(sourceCorpus)) {
        continue;
      }
      items.push({
        relativePath,
        absolutePath,
        name: `.${cls.name}`,
        line: cls.line,
        detail: "Class selector not found in source strings",
      });
    }
  }

  return items.sort(
    (a, b) =>
      a.relativePath.localeCompare(b.relativePath) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

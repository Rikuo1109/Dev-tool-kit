/**
 * Stub vscode before loading modules that transitively import it,
 * then run fixture self-checks.
 */
import Module from "node:module";

const originalRequire = Module.prototype.require;
Module.prototype.require = function (this: NodeModule, id: string) {
  if (id === "vscode") {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, fallback: unknown) => fallback,
        }),
        findFiles: async () => [],
        getWorkspaceFolder: () => undefined,
        fs: { readFile: async () => Buffer.from("") },
      },
      window: {},
      Uri: {
        file: (fsPath: string) => ({ fsPath }),
        joinPath: () => ({ fsPath: "" }),
      },
      RelativePattern: class {
        constructor(
          public base: unknown,
          public pattern: string,
        ) {}
      },
    };
  }
  return originalRequire.apply(this, [id]);
} as typeof Module.prototype.require;

async function main(): Promise<void> {
  const { selfCheckGlobMatch } = await import("./globMatch");
  const { selfCheckDeadHeuristics } = await import("./extract");
  const { selfCheckEntryDiscovery } = await import("./entryParse");
  const { selfCheckAssetGraph } = await import("./assetMatch");
  const { selfCheckClassifyFiles } = await import("./classifyFiles");

  selfCheckGlobMatch();
  selfCheckDeadHeuristics();
  selfCheckEntryDiscovery();
  selfCheckAssetGraph();
  selfCheckClassifyFiles();
  console.log("all selfChecks ok");
}

void main();

import {
  getLocalReexportTargets,
  isIndexBarrelFile,
} from "../../shared/javascript/barrelFiles";
import {
  findReachableFiles,
  ImportIndex,
} from "../../shared/javascript/importGraph";
import { AssetGraph } from "./assetGraph";
import { DeadCodeExplorerConfig } from "./config";
import {
  extractRequireContextDirs,
  isUnderAnyDir,
} from "./entryParse";
import { matchAnyGlob } from "./globMatch";
import {
  DeadBucket,
  DeadConfidence,
  DeadItem,
  DeadReason,
  EMPTY_BUCKET_COUNTS,
  FilesSummary,
} from "./types";

interface ClassifyFilesInput {
  scopedFiles: string[];
  index: ImportIndex;
  config: DeadCodeExplorerConfig;
  discoveredEntries: string[];
  entryLabels: Map<string, string>;
  assetGraph: AssetGraph;
  primaryBuckets: DeadBucket[];
}

interface ClassifyFilesResult {
  primary: DeadItem[];
  all: DeadItem[];
  summary: FilesSummary;
}

export function classifyDeadFiles(input: ClassifyFilesInput): ClassifyFilesResult {
  const {
    scopedFiles,
    index,
    config,
    discoveredEntries,
    entryLabels,
    assetGraph,
    primaryBuckets,
  } = input;

  const entrySeeds = new Set<string>([
    ...index.entryPoints,
    ...discoveredEntries,
  ]);
  const reachable = findReachableFiles(index, entrySeeds);

  const contextDirs: string[] = [];
  for (const filePath of index.files) {
    contextDirs.push(
      ...extractRequireContextDirs(index.getContent(filePath), filePath),
    );
  }

  const barrelProtected = collectBarrelProtected(index, reachable);

  const all: DeadItem[] = [];

  for (const filePath of scopedFiles) {
    const relativePath = index.relativePath(filePath);
    const classified = classifyOne({
      filePath,
      relativePath,
      index,
      config,
      entrySeeds,
      entryLabels,
      reachable,
      assetGraph,
      contextDirs,
      barrelProtected,
    });
    if (classified) {
      all.push(classified);
    }
  }

  all.sort(
    (a, b) =>
      bucketRank(a.bucket) - bucketRank(b.bucket) ||
      a.relativePath.localeCompare(b.relativePath),
  );

  const byBucket = EMPTY_BUCKET_COUNTS();
  for (const item of all) {
    const bucket = item.bucket ?? "unknown";
    byBucket[bucket] += 1;
  }

  const primary = all.filter((item) =>
    primaryBuckets.includes(item.bucket ?? "unknown"),
  );
  const noiseCount = all.length - primary.length;
  const noisePercent =
    all.length === 0 ? 0 : Math.round((noiseCount / all.length) * 100);

  return {
    primary,
    all,
    summary: {
      totalClassified: all.length,
      primaryCount: primary.length,
      noiseCount,
      noisePercent,
      byBucket,
    },
  };
}

function classifyOne(args: {
  filePath: string;
  relativePath: string;
  index: ImportIndex;
  config: DeadCodeExplorerConfig;
  entrySeeds: Set<string>;
  entryLabels: Map<string, string>;
  reachable: Set<string>;
  assetGraph: AssetGraph;
  contextDirs: string[];
  barrelProtected: Set<string>;
}): DeadItem | null {
  const {
    filePath,
    relativePath,
    index,
    config,
    entrySeeds,
    entryLabels,
    reachable,
    assetGraph,
    contextDirs,
    barrelProtected,
  } = args;

  if (matchAnyGlob(relativePath, config.ambientGlobs)) {
    return item(relativePath, filePath, {
      bucket: "ambient",
      confidence: "high",
      reason: "classified_path",
      detail: "Ambient declaration / .d.ts",
    });
  }

  if (matchAnyGlob(relativePath, config.vendorGlobs)) {
    return item(relativePath, filePath, {
      bucket: "vendor",
      confidence: "high",
      reason: "classified_path",
      detail: "Vendor / public asset path",
    });
  }

  if (matchAnyGlob(relativePath, config.toolingGlobs)) {
    return item(relativePath, filePath, {
      bucket: "tooling",
      confidence: "high",
      reason: "classified_path",
      detail: "Tooling / scripts / config",
    });
  }

  if (matchAnyGlob(relativePath, config.ignoreGlobs)) {
    return item(relativePath, filePath, {
      bucket: "unknown",
      confidence: "high",
      reason: "classified_path",
      detail: "Ignored by deadCodeExplorer.ignoreGlobs",
    });
  }

  if (entrySeeds.has(filePath)) {
    const label = entryLabels.get(filePath) ?? "configured entry";
    return item(relativePath, filePath, {
      bucket: "entry",
      confidence: "high",
      reason: "entry_seed",
      detail: `Alive entry — ${label}`,
    });
  }

  if (
    assetGraph.aliveAssets.has(filePath) ||
    (relativePath.startsWith("public/") &&
      isPublicRuntime(relativePath, assetGraph))
  ) {
    return item(relativePath, filePath, {
      bucket: "runtime",
      confidence: "medium",
      reason: "runtime_ref",
      detail: "Referenced as runtime/public asset",
      falsePositiveHint:
        "Dynamic URL strings may miss some public assets — residual risk.",
    });
  }

  if (isUnderAnyDir(filePath, contextDirs)) {
    return item(relativePath, filePath, {
      bucket: "runtime",
      confidence: "medium",
      reason: "runtime_ref",
      detail: "Under require.context directory",
    });
  }

  if (barrelProtected.has(filePath)) {
    return null; // alive via barrel re-export — omit from findings
  }

  if (reachable.has(filePath)) {
    // Reachable from some entry — not dead. Surface alternate-entry note only
    // when zero direct importers (was previously "orphan" false positive).
    const importers = index.getImporters(filePath);
    if (importers.length === 0 && !isIndexBarrelFile(filePath)) {
      return item(relativePath, filePath, {
        bucket: "entry",
        confidence: "high",
        reason: "entry_seed",
        detail: "Alive via entry graph (no direct importers, reachable)",
      });
    }
    return null;
  }

  // Unreachable from all entries
  const importers = index.getImporters(filePath);
  if (importers.length === 0) {
    return item(relativePath, filePath, {
      bucket: "dead",
      confidence: "high",
      reason: "no_importers",
      detail: "No importers and unreachable from discovered entries",
    });
  }

  // Has importers but still unreachable — importer graph may be outside seeds
  return item(relativePath, filePath, {
    bucket: "likely-dead",
    confidence: "medium",
    reason: "unreachable_from_entries",
    detail: "Has importers but not reachable from discovered entries",
    falsePositiveHint:
      "Missing entry seed or dynamic import — may be alive at runtime.",
  });
}

function isPublicRuntime(relativePath: string, assetGraph: AssetGraph): boolean {
  const rel = relativePath.replace(/\\/g, "/");
  if (/service-worker|firebase-messaging-sw/i.test(rel)) {
    return true;
  }
  if (/tinymce/i.test(rel)) {
    return true;
  }
  for (const frag of assetGraph.urlFragments) {
    if (frag && rel.includes(frag.replace(/^\//, ""))) {
      return true;
    }
  }
  // Unreferenced public file — still runtime-ish (copied wholesale often)
  return rel.startsWith("public/");
}

function collectBarrelProtected(
  index: ImportIndex,
  reachable: Set<string>,
): Set<string> {
  const protectedPaths = new Set<string>();

  for (const filePath of index.files) {
    if (!isIndexBarrelFile(filePath)) {
      continue;
    }
    const barrelAlive =
      reachable.has(filePath) ||
      index.entryPoints.has(filePath) ||
      index.getImporters(filePath).length > 0;
    if (!barrelAlive) {
      continue;
    }
    const targets = getLocalReexportTargets(
      index.getContent(filePath),
      filePath,
      index,
    );
    for (const target of targets) {
      protectedPaths.add(target);
    }
  }

  return protectedPaths;
}

function item(
  relativePath: string,
  absolutePath: string,
  fields: {
    bucket: DeadBucket;
    confidence: DeadConfidence;
    reason: DeadReason;
    detail: string;
    falsePositiveHint?: string;
  },
): DeadItem {
  return {
    relativePath,
    absolutePath,
    bucket: fields.bucket,
    confidence: fields.confidence,
    reason: fields.reason,
    detail: fields.detail,
    falsePositiveHint: fields.falsePositiveHint,
  };
}

function bucketRank(bucket: DeadBucket | undefined): number {
  switch (bucket) {
    case "dead":
      return 0;
    case "likely-dead":
      return 1;
    case "unknown":
      return 2;
    case "runtime":
      return 3;
    case "entry":
      return 4;
    case "tooling":
      return 5;
    case "ambient":
      return 6;
    case "vendor":
      return 7;
    default:
      return 8;
  }
}

/** ponytail: fixture-only classification for cds-frontend-style false positives. */
export function selfCheckClassifyFiles(): void {
  const config: DeadCodeExplorerConfig = {
    entryGlobs: [],
    ignoreGlobs: [
      "tools/**",
      "**/generate-react-cli/**",
      "**/*TemplateName*",
    ],
    vendorGlobs: ["public/**/tinymce*/**", "public/assets/**"],
    toolingGlobs: ["tools/**", "scripts/**"],
    ambientGlobs: ["**/*.d.ts"],
    primaryBuckets: ["dead", "likely-dead"],
    discoverBundlerEntries: true,
  };

  const files = [
    "/repo/public/assets/js/tinymce-5/x.js",
    "/repo/public/service-worker.js",
    "/repo/tools/generate-react-cli/TemplateName.tsx",
    "/repo/src/react-app-env.d.ts",
    "/repo/src/hooks/useFetchElementDetails.ts",
    "/repo/src/mobile.js",
    "/repo/src/App/mobile.tsx",
  ];

  const content = new Map<string, string>([
    ["/repo/src/mobile.js", "import './App/mobile'"],
    ["/repo/src/App/mobile.tsx", "export default function App() {}"],
    ["/repo/src/hooks/useFetchElementDetails.ts", "export function useX() {}"],
    ["/repo/public/service-worker.js", ""],
    ["/repo/public/assets/js/tinymce-5/x.js", ""],
    ["/repo/tools/generate-react-cli/TemplateName.tsx", ""],
    ["/repo/src/react-app-env.d.ts", ""],
  ]);

  const deps = new Map<string, string[]>([
    ["/repo/src/mobile.js", ["/repo/src/App/mobile.tsx"]],
    ["/repo/src/App/mobile.tsx", []],
  ]);
  const importers = new Map<string, string[]>([
    ["/repo/src/App/mobile.tsx", ["/repo/src/mobile.js"]],
  ]);

  const emptyJava = {
    classToFile: new Map<string, string>(),
    packageToFiles: new Map<string, Set<string>>(),
    fileToPackage: new Map<string, string>(),
    fileToSimpleName: new Map<string, string>(),
  };

  const index: ImportIndex = {
    workspaceRoot: "/repo",
    files,
    entryPoints: new Set(),
    relativePath: (abs) => abs.replace("/repo/", ""),
    getContent: (abs) => content.get(abs) ?? "",
    getDependencies: (abs) => deps.get(abs) ?? [],
    getImporters: (abs) => importers.get(abs) ?? [],
    getImports: () => [],
    resolve: () => null,
    javaTypeIndex: emptyJava,
  };

  const result = classifyDeadFiles({
    scopedFiles: files,
    index,
    config,
    discoveredEntries: ["/repo/src/mobile.js"],
    entryLabels: new Map([["/repo/src/mobile.js", "webpack entry:mobile"]]),
    assetGraph: {
      aliveAssets: new Set(["/repo/public/service-worker.js"]),
      urlFragments: new Set(["service-worker.js", "tinymce"]),
    },
    primaryBuckets: config.primaryBuckets,
  });

  const byPath = new Map(result.all.map((item) => [item.relativePath, item]));

  const expectBucket = (rel: string, bucket: DeadBucket) => {
    const hit = byPath.get(rel);
    if (!hit || hit.bucket !== bucket) {
      throw new Error(
        `${rel}: expected ${bucket}, got ${hit?.bucket ?? "missing"}`,
      );
    }
  };

  expectBucket("public/assets/js/tinymce-5/x.js", "vendor");
  expectBucket("public/service-worker.js", "runtime");
  expectBucket("tools/generate-react-cli/TemplateName.tsx", "tooling");
  expectBucket("src/react-app-env.d.ts", "ambient");
  expectBucket("src/mobile.js", "entry");
  expectBucket("src/hooks/useFetchElementDetails.ts", "dead");

  if (byPath.has("src/App/mobile.tsx")) {
    throw new Error("mobile graph file should be omitted (reachable)");
  }
  if (result.primary.length !== 1) {
    throw new Error(
      `expected 1 primary dead file, got ${result.primary.length}`,
    );
  }
  if (result.primary[0].relativePath !== "src/hooks/useFetchElementDetails.ts") {
    throw new Error("primary should be true-positive hook only");
  }
}

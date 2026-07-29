# Development

## Setup

```bash
yarn install
```

Press **F5** in the extension workspace to launch a new VS Code window with the extension loaded (runs webpack via preLaunchTask).

## Scripts

| Script               | Description                     |
| -------------------- | ------------------------------- |
| `yarn compile`       | Webpack dev build               |
| `yarn watch`         | Webpack watch mode              |
| `yarn lint`          | ESLint on `src/`                |
| `yarn test`          | Run extension tests             |
| `yarn vsix`          | Production build + package VSIX (non-interactive) |
| `yarn install:local` | Build VSIX + install via `cursor` or `code` CLI   |

If `yarn install:local` says neither CLI is on PATH, the `.vsix` is still built — install with Command Palette → **Extensions: Install from VSIX…**, or add the Cursor/VS Code shell command to PATH.

## Project Layout

```
src/
  extension.ts                  # activate / deactivate entry
  commands.ts                   # command definitions + registration
  shared/
    constants.ts                # source globs
    gitignore.ts                # .gitignore filtering via git
    language.ts                 # file language detection (JS/Python/Java)
    resolveUri.ts               # shared workspace folder resolver
    theme.ts                    # light/dark theme tokens
    html.ts                     # HTML escape + dark theme detection
    panel.ts                    # webview boilerplate (CSP, styles, helpers)
    openInEditor.ts             # file open + webview message handler
    javascript/
      importGraph.ts            # JS/TS import graph + multi-language index
      barrelFiles.ts            # barrel index.ts heuristics
    java/
      graph.ts                  # Java import parsing + type index
      entryPoints.ts            # pom/gradle/Spring Boot entries
    python/
      graph.ts                  # Python import parsing
      entryPoints.ts            # pyproject.toml / __main__ entries
  features/
    dashboard/                  # file count stats + git change chart
    organize-imports/           # bulk organize imports
    code-graph/                 # file dependency graph (vis.js)
    code-analyze/               # dead code, duplicates, large units
    pre-merge-review/           # diff-only PR quality gate
    init-ai-template/           # gitnexus + caveman + ponytail setup
  test/
    extension.test.ts           # test suite placeholder
```

## Commands

| Command ID                      | Title            | How to invoke                                      |
| ------------------------------ | ---------------- | -------------------------------------------------- |
| `kyo-tools.initAiTemplate`     | Init AI Template | Command Palette                                    |
| `code-dashboard.open`          | Code Dashboard   | Explorer → right-click **folder**                  |
| `kyo-tools.organizeImports`    | Organize Imports | Explorer → right-click **folder** (hidden in palette) |
| `kyo-tools.codeGraph`          | Code Graph       | Explorer → right-click **file**                    |
| `kyo-tools.codeAnalyze`        | Code Analyze     | Explorer → right-click **folder** · Command Palette |
| `kyo-tools.preMergeReview`     | Pre-Merge Review | Command Palette                                    |

## Configuration

All settings under `kyo-tools.codeAnalyze.*`:

| Setting                              | Type   | Default | Description                                |
| ------------------------------------ | :----: | :-----: | ------------------------------------------ |
| `kyo-tools.codeAnalyze.entryGlobs`   | array  | see source | Entry point patterns excluded from unused detection |
| `kyo-tools.codeAnalyze.excludeGlobs` | array  | see source | Files excluded from analysis               |
| `kyo-tools.codeAnalyze.duplicateMinLines` | number | 6    | Minimum non-empty lines for duplicate detection |
| `kyo-tools.codeAnalyze.largeFileLoc` | number | 300     | Warn when file exceeds this many lines     |
| `kyo-tools.codeAnalyze.largeFunctionLoc` | number | 80   | Warn when function exceeds this many lines |
| `kyo-tools.codeAnalyze.largeFunctionParams` | number | 5 | Warn when function exceeds this many params |

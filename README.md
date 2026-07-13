# kyo-tools

Cursor/VS Code extension — workspace-level code analysis, quality gates, and AI project setup.

## Install

```bash
yarn install
yarn install:local   # build VSIX + install into Cursor
```

Press **F5** in the extension workspace for development (runs webpack via preLaunchTask).

## Commands

| Command              | Palette  | Explorer | Notes                              |
| -------------------- | :------: | :------: | ---------------------------------- |
| **Init AI Template** | Yes      | —        | Bootstraps GitNexus + Cursor rules |
| **Code Dashboard**   | Yes      | Folder   | `cloc` stats + git change history  |
| **Code Analyze**     | Yes      | Folder   | Dead code, duplicates, large units |
| **Pre-Merge Review** | Yes      | —        | Diff-only quality gate             |
| **Code Graph**       | Yes      | File     | Import/dependency graph for a file |
| **Organize Imports** | —        | Folder   | Batch organize imports             |

## Features

### Code Dashboard

Runs `cloc --json --by-file` on a folder (uses `git ls-files` in repos so `.gitignore` is respected). Shows language breakdown, doughnut chart, and top/smallest files per language.

**Git stats** (last 30 days, scoped to selected folder): daily added/deleted/net line counts from `git log --numstat`.

> Requires `cloc` on `PATH` (`brew install cloc`) and a git repository.

### Code Analyze

Static analysis for TypeScript/JavaScript/React, Python, and Java. Sticky header with stats and tabs — scroll the report without losing context.

| Tab            | What it finds                                                           |
| -------------- | ----------------------------------------------------------------------- |
| Unused files   | Files with zero importers (entry points excluded)                       |
| Orphans        | Modules not reachable from entry points                                 |
| Exports        | Exported symbols with no usage across JS/TS, Python, Java               |
| Duplicates     | Exact (same text) and structural (same shape) blocks above threshold    |
| Large files    | Files exceeding `largeFileLoc` non-empty lines                          |
| Large fns      | Functions exceeding `largeFunctionLoc` lines or `largeFunctionParams` params |

Each duplicate group has a **Copy for AI** button — copies a refactor prompt with locations, preview, and suggestion to clipboard.

Barrel `index.ts` files that re-export used siblings are not flagged as unused.

**Python/Java:** Java resolves wildcard imports, same-package refs, entry points from build files / `@SpringBootApplication`. Python checks `__all__` and `from … import` / `import … as` usage. Dynamic imports and framework-driven references may produce false positives.

### Pre-Merge Review

Diff-only quality gate. On run, pick a branch to compare with your current branch. Scans **added/changed lines only** on both sides since merge-base.

**JavaScript / TypeScript**
`console.log` · `debugger` · TODO/FIXME · commented-out code · unused imports · `any` / `@ts-ignore` · unsafe assertions · inline JSX functions · large added blocks

**Python**
`print()` · TODO/FIXME · bare `except:` · `eval`/`exec` · dynamic imports · `Any` typing · inefficient loops

**Java**
`System.out.println` · TODO/FIXME · empty catch · raw types · reflection · performance hints

**Dependencies**
`package.json` / lockfile changes · new heavy packages

Issues grouped by file, click to jump to line. Severity: Critical / Warning / Info.

### Code Graph

Builds an import/dependency graph for the selected file: dependencies, dependents (import scan + Reference Provider), external packages. Click nodes to expand. Supports `tsconfig` / `jsconfig` path aliases.

### Organize Imports

Batch organize imports across `ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, and `vue` files in a folder. Progress panel with Updated / Unchanged / Failed tabs. Hidden from Command Palette — use the Explorer context menu.

### Init AI Template

Bootstraps AI tooling for the current workspace:

| Component        | Installs                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| GitNexus         | `npx gitnexus setup` (MCP + skills) and `npx gitnexus analyze`          |
| Caveman lite     | `.cursor/rules/caveman-lite.mdc` — tight response mode, `alwaysApply`   |
| Ponytail         | `.cursor/rules/ponytail.mdc` — YAGNI / minimal-diff mindset             |

Also writes `.cursor/skills/caveman/SKILL.md` and `.cursor/kyo-tools-ai-template.json`. Existing files prompt for overwrite or skip.

## Settings

| Setting                                | Type    | Default | Description                              |
| -------------------------------------- | :-----: | :-----: | ---------------------------------------- |
| `kyo-tools.codeAnalyze.entryGlobs`     | array   | (see below) | Entry point patterns excluded from unused detection |
| `kyo-tools.codeAnalyze.excludeGlobs`   | array   | (see below) | Files excluded from analysis             |
| `kyo-tools.codeAnalyze.duplicateMinLines` | number | 6    | Minimum non-empty lines for duplicate detection |
| `kyo-tools.codeAnalyze.largeFileLoc`   | number  | 300     | Warn when a file exceeds this many lines |
| `kyo-tools.codeAnalyze.largeFunctionLoc` | number | 80    | Warn when a function exceeds this many lines |
| `kyo-tools.codeAnalyze.largeFunctionParams` | number | 5  | Warn when a function has more than this many params |

## Project layout

```
src/
  extension.ts                  # activate / deactivate entry
  commands.ts                   # command definitions + registration
  shared/
    constants.ts                # source globs
    gitignore.ts                # .gitignore filtering via git
    language.ts                 # file language detection
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
    dashboard/                  # cloc stats + git change chart
    organize-imports/           # bulk organize imports
    code-graph/                 # file dependency graph
    code-analyze/               # dead code, duplicates, large units
    pre-merge-review/           # diff-only PR quality gate
    init-ai-template/           # gitnexus + caveman + ponytail setup
  test/
    extension.test.ts           # test suite placeholder
```

## Requirements

- **VS Code / Cursor** `^1.105.0`
- **Code Dashboard** — `cloc` on `PATH` (`brew install cloc`)
- **Init AI Template** — Node.js + network for `npx gitnexus`

## Scripts

| Script               | Description                     |
| -------------------- | ------------------------------- |
| `yarn compile`       | Webpack dev build               |
| `yarn watch`         | Webpack watch mode              |
| `yarn lint`          | ESLint on `src/`                |
| `yarn test`          | Run extension tests             |
| `yarn vsix`          | Production build + package VSIX |
| `yarn install:local` | Build VSIX + install to Cursor  |

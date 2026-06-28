# kyo-tools

Cursor/VS Code extension for workspace-level code tools and AI project setup.

## Install

```bash
yarn install
yarn install:local   # build VSIX + install into Cursor
```

For development, press **F5** in the extension workspace (runs webpack compile via preLaunchTask).

## Commands

| Command              | How to run                                          |
| -------------------- | --------------------------------------------------- |
| **Init AI Template** | Command Palette → `Init AI Template`                |
| **Code Dashboard**   | Explorer → right-click **folder**                   |
| **Organize Imports** | Explorer → right-click **folder**                   |
| **Code Analyze**     | Explorer → right-click **folder** · Command Palette |
| **Pre-Merge Review** | Command Palette · Source Control title bar          |
| **Code Graph**       | Explorer → right-click **file**                     |

Explorer **Organize Imports** is hidden from the Command Palette by design.

## Features

### Code Dashboard

Runs `cloc --json --by-file` on a folder (uses `git ls-files` in git repos so `.gitignore` is respected). Shows language stats, chart, and top/smallest files per language. Click a file to open it; **Reload** to rescan.

Also reads **git history** (last 30 days, scoped to the selected folder):

- **Today** — added / deleted / net line counts
- **Chart** — daily added (green), deleted (red), and net (line) from `git log --numstat`

Requires the folder to be inside a git repository.

### Organize Imports

Organizes imports across all `ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, and `vue` files in a folder. Live progress panel with Updated / Unchanged / Failed tabs.

### Code Graph

Builds an import/dependency graph for the selected file: dependencies, dependents (import scan + Reference Provider), and external packages. Supports path aliases from `tsconfig` / `jsconfig`.

### Code Analyze

Static analysis for TypeScript/JavaScript/React, **Python**, and **Java** folders. Report panel keeps the header, stats, and tabs pinned while you scroll.

Supported sources: `.ts/.tsx/.js/.jsx/.vue`, `.py`, `.java`. JS/TS and Python/Java are analyzed in separate import graphs (no cross-language import edges). Files matched by `.gitignore` are skipped in git repositories.

**Dead / unused code**

- **Unused files** — no importers (entry points excluded)
- **Orphan modules** — not reachable from entry points via the import graph
- **Unused exports** — exported symbols with no usage (JS/TS, Python module symbols, Java public static members)

**Duplicate code detector**

- Finds duplicated blocks above `duplicateMinLines` (default 6)
- Sorted by number of locations (most copies first), then line count
- **Exact** — same text after comment/whitespace normalization → suggest shared utility
- **Structural** — same shape with different identifiers/literals → suggest shared helper
- **Copy for AI** on each duplicate block — copies a refactor prompt (locations, preview, suggestion) to the clipboard

**Large file / function detector**

- **Large files** — non-empty LOC above `largeFileLoc` (default 300)
- **Large functions** — body LOC above `largeFunctionLoc` (default 80) or params above `largeFunctionParams` (default 5)
- Each hit includes a split/refactor suggestion

Click rows to open files. **Reload** to rescan.

Barrel `index.ts` files that re-export used siblings are not flagged as unused.

**Python/Java notes:** Java resolves wildcard imports, same-package references, entry points from build files / `@SpringBootApplication`, and flags unused public static members. Python checks `__all__` or top-level public symbols against `from … import` / `import … as` usage. Dynamic imports and framework-driven Java references may still produce false positives.

### Pre-Merge Review

Diff-only quality gate before merging. On run, a **branch picker** lists local and remote branches — choose one to compare with your **current branch**. Scans **added/changed lines only** on both sides since merge-base — never full-repo scan.

**JavaScript / TypeScript** — `console.log`, `debugger`, TODO/FIXME, commented-out code, unused imports, `any` / `@ts-ignore`, unsafe assertions, inline JSX functions, large added blocks

**Python** — `print()`, TODO/FIXME, bare `except:`, `eval`/`exec`, dynamic imports, `Any` typing, inefficient loops

**Java** — `System.out.println`, TODO/FIXME, empty catch, raw types, reflection, performance hints

**Dependencies** — `package.json` / lockfile changes, new heavy packages

Report grouped by file. Click issue → jump to line. Severity: Critical / Warning / Info.

Configure via `kyo-tools.codeAnalyze.*` settings (legacy `kyo-tools.deadCode.*` globs still read as fallback).

### Init AI Template

Bootstraps AI tooling for the current workspace:

| Component        | What it installs                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **GitNexus**     | `npx gitnexus setup` (global MCP + skills) and `npx gitnexus analyze` when the workspace is a git repo |
| **Caveman lite** | `.cursor/rules/caveman-lite.mdc` — tight responses, `alwaysApply`, lite default on new chats           |
| **Ponytail**     | `.cursor/rules/ponytail.mdc` — YAGNI / minimal-diff mindset, `alwaysApply`                             |

Also writes `.cursor/skills/caveman/SKILL.md` and `.cursor/kyo-tools-ai-template.json`. Existing files prompt for overwrite or skip. Output goes to **Kyo Tools — Init AI Template**.

## Requirements

- **Code Dashboard** — `cloc` on `PATH` (`brew install cloc`); git repo for change stats
- **Init AI Template** — Node.js + network for `npx gitnexus`
- **VS Code / Cursor** — `^1.105.0` (see `engines.vscode`)

## Project layout

```
src/
  extension.ts                 # activate / deactivate entry
  commands.ts                  # command definitions + registration
  shared/
    constants.ts               # source globs
    gitignore.ts               # .gitignore filtering via git
    language.ts                # file language detection
    theme.ts / html.ts         # shared webview helpers
    panel.ts / openInEditor.ts
    javascript/
      importGraph.ts           # JS/TS import graph + multi-language index
      barrelFiles.ts           # barrel index.ts heuristics
    java/
      graph.ts                 # Java import parsing + type index
      entryPoints.ts           # pom/gradle/Spring Boot entries
    python/
      graph.ts                 # Python import parsing
      entryPoints.ts           # pyproject.toml / __main__ entries
  features/
    dashboard/                 # cloc stats + webview
    organize-imports/          # bulk organize imports
    code-graph/                # file dependency graph
    code-analyze/              # unused code, duplicates, large units
    pre-merge-review/          # diff-only PR quality gate
    init-ai-template/          # gitnexus + caveman + ponytail setup
```

## Scripts

| Script               | Description                     |
| -------------------- | ------------------------------- |
| `yarn compile`       | Webpack dev build               |
| `yarn watch`         | Webpack watch mode              |
| `yarn lint`          | ESLint on `src/`                |
| `yarn vsix`          | Production build + package VSIX |
| `yarn install:local` | Install VSIX into Cursor        |

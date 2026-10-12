# Kyo Tools

Code analysis and quality tools for Cursor & VS Code.

## Features

### Code Analyze

Scans a folder for code issues. Supports TypeScript, JavaScript, React, Python, and Java.

- **Unused code** — files with no importers, orphan modules, unused exports
- **Duplicates** — exact and structural duplicate code blocks with suggestions
- **Large files/functions** — warns when files or functions exceed configurable thresholds
- **Copy for AI** — each duplicate block has a button to copy a refactor prompt for AI chat

Thresholds are configurable via `kyo-tools.codeAnalyze.*` settings.

### Pre-Merge Review

Diff-only quality check before merging. Pick a branch to compare against — only scans added/changed lines since merge-base.

Checks for `console.log`, `debugger`, `any` usage, commented-out code, unused imports, bare excepts, hardcoded secrets, new dependencies, and more across JS/TS, Python, and Java. Issues are grouped by file with click-to-jump. Severity: Critical, Warning, or Info.

### Code Graph

Import graph of the whole workspace, browsed folder by folder so it stays readable on large codebases (`Kyo Tools: Code Graph` from the command palette, or right-click a file or folder in Explorer).

- **Clusters** — each level shows the subfolders of one folder as clusters (sized by file count) and its own files. Folders that only wrap a single subfolder are merged (`com/example/app`).
- **Group by communities** — switch grouping from folders to communities: files that import each other a lot are grouped together (Louvain), whatever folder they live in, with finer communities inside. Groups are named after the folders they mostly come from; the details list their folders.
- **Drill down** — click a cluster to open it; the breadcrumb, `Backspace` or `Alt+←` go back up. Opening from a file starts at its folder with the file selected.
- **Layers layout** (default) — importers sit on top, what they import below, in a few bands so large levels stay readable. Switch to a free **force** layout from the toolbar.
- **Weighted edges** — imports between clusters are summed into one edge; its count shows on hover. Click an edge to list the file pairs behind it.
- **Red edges break the layering** — of all the imports between groups, only the few that point back up (against the layer order) are red: they are the imports that close dependency cycles, usually the ones to cut. The cycles chip lists every cycle at the current level (including loops like `a → b → c → a`) and highlights it.
- **Edge filter & tracing** — `Edges: auto` keeps the strongest ~60 edges (red ones need half the count); pick a fixed minimum or show all. Hover a node to trace its imports with counts while everything else fades; click a file to pin it.
- **Outside context** — imports crossing the current folder are drawn to dashed nodes for the branch they come from; click one to go there.
- **Details** — click a file to see what it imports and what imports it; click a cluster's details for what it uses and is used by. Copy paths or file contents for AI.
- **Unused files** — files nothing imports (not entry points, barrels or tests) have a red dashed outline. _Highlight: unused_ dims everything else, marks files only tests import, and shows how many unused files each group holds.
- **Hubs / utilities** — _Highlight: hubs_ labels every file with its importer count and colours the most imported ones; each group shows its most imported file.
- **Insights panel** — with nothing selected, the side panel lists the unused files, test-only files, most imported files (with how many folders import them) and most imported exports for the current group and below. A file's details show which of its exports are used by how many files, and which exports nothing imports (click to jump to the line).
- **Full map** — _View: full map_ draws every file and import at once (up to 4,000 most connected files), coloured by top-level group and sized by importer count. Labels appear as you zoom in; with many imports, only the hovered or selected file's edges are drawn. Highlight, search and the insights panel work here too.
- **Search** — find any file or folder and jump to it.
- **Packages** — toggle to show external packages imported at the current level.
- **Focus graph** — the classic single-file view (dependencies below, dependents above, click to expand).
- Includes test files, supports `tsconfig`/`jsconfig` path aliases, works offline. **Reload** rebuilds the index; it is marked `•` when source files change.

### Code Dashboard

Language stats, file size chart, and git change history (last 30 days).

### Commit Heatmap

GitHub-style calendar of commits for the whole project (`Kyo Tools: Commit Heatmap` from the command palette, or right-click a folder in Explorer).

- Covers the workspace folder's repo and every repo nested inside it; when the folder is not a repo itself, each inner repo is included. Commits are read from each repo's `HEAD` and de-duplicated by hash.
- Range: last 3 / 6 / 12 months (default 12), all time, or a single year.
- Author filter: all authors, **Only me** (your `git config user.email`), or any single author — your identity is listed first.
- Stats for the selected range: total commits, active days, longest streak, busiest day, plus your current streak.
- Hover a day for its count; click it to list that day's commits (repo, short hash, subject, author). Click a hash to copy it.
- **Reload** only re-reads repos whose `HEAD` changed.

### Hotspots

Finds the files most worth refactoring: ones that change often **and** are complex (`Kyo Tools: Hotspots`, or right-click a folder).

- **Churn** from `git log --numstat` (no merges) across the folder's repo and nested repos: commits, lines added/removed, authors. Renames are followed to the current path.
- **Complexity** of each changed source file (JS/TS/Vue, Python, Java): decision points (`if`, loops, `case`, `catch`, `&&`, `||`, ternaries…), lines of code, longest function.
- **Score** = commits × complexity, scaled so the hottest file is 100 (≥ 50 counts as a hotspot).
- Range: last 3 / 6 / 12 months (default 6). Scatter chart of churn vs complexity plus a ranked, filterable table; click a file or point to open it.
- **Copy for AI** on each row copies a refactor prompt with the file and its stats.

### Copy for AI

- **Copy Folder Code for AI** (right-click a folder): respects `.gitignore`, skips binaries/lockfiles/generated files, then lets you pick **Full source** or **Signatures only** (imports, types and signatures; function bodies become `{ … }`) — each option shows its size and token estimate before copying.
- **Copy File with Dependencies for AI** (right-click a file, editor context menu or command palette): copies a file together with its direct dependencies, all transitive dependencies, or direct dependencies + dependents, using the same import graph as Code Graph (incl. path aliases). Dependencies can be copied as signatures only while the target file stays complete.

### Organize Imports

Batch organize imports across `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue` files. Progress panel with results tabs.

### Init AI Template

Sets up GitNexus (MCP server + skills) and Cursor rules (caveman lite, ponytail) in one command.

## Requirements

- Cursor / VS Code `^1.105.0`
- Node.js + internet for Init AI Template

## Settings

| Setting                                      |            Default            | Description                                                                                                                                        |
| -------------------------------------------- | :---------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kyo-tools.codeAnalyze.duplicateMinLines`    |               6               | Min lines for duplicate detection                                                                                                                  |
| `kyo-tools.codeAnalyze.largeFileLoc`         |              300              | Warn above this file line count                                                                                                                    |
| `kyo-tools.codeAnalyze.largeFunctionLoc`     |              80               | Warn above this function line count                                                                                                                |
| `kyo-tools.codeAnalyze.largeFunctionParams`  |               5               | Warn above this param count                                                                                                                        |
| `kyo-tools.codeAnalyze.javaEntryAnnotations` | Spring/JAX-RS/CDI stereotypes | Java classes with these annotations (e.g. `@RestController`, `@Configuration`, `@Bean`/`@Scheduled` methods) count as entry points, never "unused" |

See `kyo-tools.codeAnalyze.*` in VS Code settings for entry/exclude globs and more.

## Development

See [docs/development.md](docs/development.md).

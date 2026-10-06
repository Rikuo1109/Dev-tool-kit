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

Dependency graph for a single file. Shows dependencies, dependents, and external packages. Supports `tsconfig`/`jsconfig` path aliases.

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

### Organize Imports

Batch organize imports across `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue` files. Progress panel with results tabs.

### Init AI Template

Sets up GitNexus (MCP server + skills) and Cursor rules (caveman lite, ponytail) in one command.

## Requirements

- Cursor / VS Code `^1.105.0`
- Node.js + internet for Init AI Template

## Settings

| Setting                                     | Default | Description                         |
| ------------------------------------------- | :-----: | ----------------------------------- |
| `kyo-tools.codeAnalyze.duplicateMinLines`   |    6    | Min lines for duplicate detection   |
| `kyo-tools.codeAnalyze.largeFileLoc`        |   300   | Warn above this file line count     |
| `kyo-tools.codeAnalyze.largeFunctionLoc`    |   80    | Warn above this function line count |
| `kyo-tools.codeAnalyze.largeFunctionParams` |    5    | Warn above this param count         |

See `kyo-tools.codeAnalyze.*` in VS Code settings for entry/exclude globs and more.

## Development

See [docs/development.md](docs/development.md).

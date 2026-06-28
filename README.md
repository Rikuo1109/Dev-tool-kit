# kyo-tools

Cursor/VS Code extension for workspace-level code tools and AI project setup.

## Install

```bash
yarn install
yarn install:local   # build VSIX + install into Cursor
```

For development, press **F5** in the extension workspace (runs webpack compile via preLaunchTask).

## Commands

| Command              | How to run                           |
| -------------------- | ------------------------------------ |
| **Init AI Template** | Command Palette → `Init AI Template` |
| **Code Dashboard**   | Explorer → right-click **folder**    |
| **Organize Imports** | Explorer → right-click **folder**    |
| **Dead Code Scan**   | Explorer → right-click **folder**    |
| **Code Graph**       | Explorer → right-click **file**      |

Explorer commands are hidden from the Command Palette by design.

## Features

### Code Dashboard

Runs `cloc --json --by-file` on a folder. Shows language stats, chart, and top/smallest files per language. Click a file to open it; **Reload** to rescan.

### Organize Imports

Organizes imports across all `ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, and `vue` files in a folder. Live progress panel with Updated / Unchanged / Failed tabs.

### Code Graph

Builds an import/dependency graph for the selected file: dependencies, dependents (import scan + Reference Provider), and external packages. Supports path aliases from `tsconfig` / `jsconfig`.

### Dead Code Scan

Detects unused code in TypeScript/JavaScript/React projects:

- **Unused files** — no importers (entry points excluded)
- **Orphan modules** — not reachable from entry points via the import graph
- **Unused exports** — exported symbols with no usage

Barrel `index.ts` files that re-export used siblings are not flagged as unused.

Configure via settings:

- `kyo-tools.deadCode.entryGlobs` — entry points (default: `main`, `index`, `App`, config files, Next/Vite entrypoints)
- `kyo-tools.deadCode.excludeGlobs` — skip tests, specs, mocks

### Init AI Template

Bootstraps AI tooling for the current workspace:

| Component        | What it installs                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **GitNexus**     | `npx gitnexus setup` (global MCP + skills) and `npx gitnexus analyze` when the workspace is a git repo |
| **Caveman lite** | `.cursor/rules/caveman-lite.mdc` — tight responses, `alwaysApply`, lite default on new chats           |
| **Ponytail**     | `.cursor/rules/ponytail.mdc` — YAGNI / minimal-diff mindset, `alwaysApply`                             |

Also writes `.cursor/skills/caveman/SKILL.md` and `.cursor/kyo-tools-ai-template.json`. Existing files prompt for overwrite or skip. Output goes to **Kyo Tools — Init AI Template**.

## Requirements

- **Code Dashboard** — [`cloc`](https://github.com/AlDanial/cloc) on `PATH` (`brew install cloc`)
- **Init AI Template** — Node.js + network for `npx gitnexus`
- **VS Code / Cursor** — `^1.105.0` (see `engines.vscode`)

## Project layout

```
src/
  extension.ts                 # activate / deactivate entry
  commands.ts                  # command definitions + registration
  shared/
    importGraph.ts             # import parsing, tsconfig paths, graph index
    barrelFiles.ts             # barrel index.ts heuristics
    constants.ts               # source globs
    theme.ts / html.ts         # shared webview helpers
  features/
    dashboard/                 # cloc stats + webview
    organize-imports/          # bulk organize imports
    code-graph/                # file dependency graph
    dead-code/                 # unused files / exports scan
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

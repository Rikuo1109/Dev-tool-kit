# Change Log

All notable changes to the "kyo-tools" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Code Graph: whole-workspace graph browsed by cluster with drill-down, folder or community (Louvain) grouping, layers/force layout, cycle highlighting, insights panel and full map
- Code Graph: user filter box (glob include/exclude patterns, plain-text match), Hide tests and minimum-importers toggles; applies to clusters, cycles, insights and the full map, and is remembered per workspace
- Code Analyze: Java Spring DI classes (and configurable annotations) count as entry points
- Commit Heatmap: GitHub-style calendar for the whole project (nested repos included), range and author filters, streaks, per-day commit list, 9-level log colour scale (per month or whole range)
- Code Dashboard: git chart now shows daily totals for the last 30 days (no more month/day mix), two-column layout with a Languages card (top 8 + Other, collapsible full list)
- Code Dashboard: weekday × hour commit grid (last 90 days, local time, nested repos included, log colour scale shared with the Commit Heatmap)
- Code Dashboard: much faster reload (async scan, cached line counts and git history); respects each nested repo's `.gitignore`
- Hotspots: churn × complexity ranking with scatter chart, range picker and per-file "Copy for AI" refactor prompt
- Copy Folder Code for AI: choose full source or signatures only, with token estimates up front
- Copy with Related Files (renamed from Copy File with Dependencies for AI): file + direct/transitive dependencies or dependents, optional signatures-only dependencies
- Initial release

# Change Log

All notable changes to the "kyo-tools" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Code Graph: whole-workspace graph browsed by cluster with drill-down, folder or community (Louvain) grouping, layers/force layout, cycle highlighting, insights panel and full map
- Code Analyze: Java Spring DI classes (and configurable annotations) count as entry points
- Commit Heatmap: GitHub-style calendar for the whole project (nested repos included), range and author filters, streaks, per-day commit list, 9-level log colour scale (per month or whole range)
- Code Dashboard: much faster reload (async scan, cached line counts and git history); respects each nested repo's `.gitignore`
- Hotspots: churn × complexity ranking with scatter chart, range picker and per-file "Copy for AI" refactor prompt
- Copy Folder Code for AI: choose full source or signatures only, with token estimates up front
- Copy with Related Files (renamed from Copy File with Dependencies for AI): file + direct/transitive dependencies or dependents, optional signatures-only dependencies
- Initial release

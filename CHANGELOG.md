# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-03-24

### Added
- Initial scaffold from tauri-template with SQLite schema and CRUD commands
- Kanban board with drag-drop, add/edit/delete jobs
- FastAPI sidecar skeleton with health monitoring and Tauri lifecycle management
- Profile management, keychain credentials, and file picker integration
- Ashby API submission with form fetching and field mapping
- Greenhouse API adapter with batch SSE streaming and Submit Console
- Playwright base service, LinkedIn Easy Apply adapter, and Claude AI field mapping
- Indeed, Gem, Workday, and Generic browser adapters (Phase 2)
- Follow-up email pipeline with Claude AI drafting and Gmail send
- Interview prep briefs and analytics dashboard
- Sidebar badges and keyboard shortcuts

### Fixed
- Database: run migrations via sqlx instead of tauri-plugin-sql
- Tauri: disable removeUnusedCommands stripping custom IPC commands
- Sidecar: create binaries dir before bundle copy
- v1.0 post-build audit: cascade delete, centralized sidecar URL, clippy/ruff fixes

### Changed
- Refreshed npm lockfile for current app dependencies
- Optimized analytics queries, extracted constants, hardened Gmail/Claude integration
- Added staleTime and documented v1.1 backlog

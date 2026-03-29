# Job Command Center

[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript)](#) [![Rust](https://img.shields.io/badge/Rust-dea584?style=flat-square&logo=rust)](#) [![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#)

> Most Tauri starters give you a blank canvas. This gives you a working application with every pattern already established.

JobCommandCenter is a production-ready Tauri v2 desktop template designed for building multi-window, keyboard-driven apps with React and TypeScript. Every common desktop app pattern is already wired up: command palette, global shortcuts, native menus, multi-window with NSPanel overlay, auto-updates, theme system, i18n with RTL, preferences with Rust-side persistence, and structured logging.

Also ships with Claude Code integration — custom commands, specialized agents, and architecture docs written to explain the "why" to AI coding tools.

## What's Built

- **Command Palette** (`Cmd+K`) — searchable launcher with keyboard navigation
- **Quick Pane** (`Cmd+Shift+.`) — floating overlay window that works above fullscreen apps via NSPanel on macOS
- **Native Menus** — File, Edit, View menus built from JavaScript with full i18n support
- **Preferences System** — settings dialog with Rust-side persistence, React hooks, and type-safe access
- **Theme System** — light/dark with system preference detection, synced across all windows
- **Auto-updates** — Tauri updater configured with GitHub Releases integration
- **Crash Recovery** — emergency data persistence for recovering unsaved work
- **Collapsible Sidebars** — resizable panels with state persistence
- **Structured Logging** — consistent utilities for both Rust and TypeScript sides

## Quick Start

### Prerequisites

- Node.js 18+
- Rust stable toolchain (`rustup`)
- Tauri system dependencies: [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

### Installation

```bash
git clone https://github.com/saagpatel/JobCommandCenter
cd JobCommandCenter
npm install
```

### Usage

```bash
# Start in development mode
npm run dev

# Full quality gate (TypeScript, ESLint, ast-grep, clippy, tests)
npm run check:all
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 |
| Frontend | React 19, TypeScript, Vite 7 |
| UI | shadcn/ui v4, Tailwind CSS v4, Lucide React |
| State | Zustand v5, TanStack Query v5 |
| Type-safe bridge | `tauri-specta` (generates TS bindings from Rust) |
| i18n | i18next + react-i18next (RTL supported) |
| Quality | ESLint, Prettier, ast-grep, knip, jscpd, clippy |
| Testing | Vitest v4, Testing Library |

## Architecture

Three-layer state model: `useState` for component-local state, Zustand for global UI state, TanStack Query for persistent data not owned by the app. All Rust commands are typed via `tauri-specta` — TypeScript bindings are generated from Rust function signatures at build time. Menus, shortcuts, and the command palette all route through the same command system, so adding a new action means registering it once.

## License

MIT

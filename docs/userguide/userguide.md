# App User Guide

## Getting Started

Welcome! Job Command Center automates your job-search pipeline — tracking listings, submitting applications, managing follow-up emails, and preparing for interviews. This guide covers all available features.

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut        | Mac          | Windows/Linux | Action                |
| --------------- | ------------ | ------------- | --------------------- |
| Command Palette | Cmd+K        | Ctrl+K        | Open command palette  |
| Preferences     | Cmd+,        | Ctrl+,        | Open preferences      |
| Quick Pane      | Configurable | Configurable  | Open quick entry pane |
| Left Sidebar    | Cmd+1        | Ctrl+1        | Toggle left sidebar   |
| Right Sidebar   | Cmd+2        | Ctrl+2        | Toggle right sidebar  |

## Core Features

### Command Palette

Press **Cmd+K** to open the command palette - a quick way to find and run any action. Start typing to search through available commands.

### Quick Pane

The Quick Pane is a small floating window that can be summoned with a global keyboard shortcut, even when the app is in the background. Use it for quick data entry or actions without switching to the main window.

Configure the Quick Pane shortcut in **Preferences → Keyboard Shortcuts**.

### Preferences

Press **Cmd+,** to open preferences:

- **Theme**: Light, Dark, or System
- **Language**: Select your preferred language
- **Keyboard Shortcuts**: Customize the Quick Pane shortcut

### Native Menus

Access features from the menu bar:

- **App Menu**: About, Check for Updates, Preferences, Quit
- **View Menu**: Toggle sidebars

All menu items have keyboard shortcuts and are also available in the command palette.

## Layout

- **Title Bar**: Window controls and app title
- **Left Sidebar**: Collapsible panel (Cmd+1)
- **Main Content**: Primary app content
- **Right Sidebar**: Collapsible panel (Cmd+2)

## Updates

The app checks for updates automatically:

- Manual check: App menu → Check for Updates
- Updates download from GitHub releases
- You'll be notified when updates are available

---

## Job Search Features

### Job Tracker

The main view (left sidebar → **Tracker**) shows a Kanban board of your job applications. Each card represents one job. Drag cards between columns to update status. Click a card to open the detail panel, where you can add notes and view history.

### Submission Console

The **Submit** view lets you queue and submit applications in batch. Select jobs with status _Applied_ or _Ready_, choose the ATS platform, and click **Submit**. Progress streams in real time via SSE. Ashby and Greenhouse submit via their APIs; LinkedIn, Indeed, Gem, Workday, and Generic use a headed browser session (requires Playwright Chromium installed).

### Follow-up Manager

The **Follow-ups** view shows emails due for follow-up, grouped by job. Click a row to review or edit the AI-drafted message, then send via Gmail. Sending requires completing the Gmail OAuth2 flow in **Settings → Credentials**.

### Interview Prep

The **Interview** view shows a notes editor and an AI brief for the selected job. Click **Generate Brief** to call Claude AI (requires an Anthropic API key in **Settings → Credentials**). Briefs summarize the company, role, and likely interview topics.

### Analytics

The **Analytics** view shows pipeline funnel metrics, submission counts by ATS platform, and response rate trends. Data is read from the local SQLite database and updates automatically.

### Settings

Open **Settings** from the left sidebar or the command palette:

- **Profile** — your name, email, phone, and resume path used to populate ATS forms
- **Credentials** — API keys and OAuth tokens (stored in macOS Keychain, never on disk or in SQLite)
- **Platforms** — enable/disable ATS platforms and configure per-platform options

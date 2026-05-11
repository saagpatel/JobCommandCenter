# AI Tooling

This document captures Claude Code-specific commands and task-focused agents that are useful context for this template. They are tooling references, not universal Codex instructions.

## Claude Code Commands

- `/check` - Check work against architecture, run `npm run check:all`, and suggest a commit message.
- `/cleanup` - Run static analysis such as knip, jscpd, and `check:all`, then return structured recommendations.
- `/init` - One-time template initialization for app name, description, and configuration updates.

## Claude Code Agents

- `plan-checker` - Validate implementation plans against documented architecture.
- `docs-reviewer` - Review developer docs for accuracy and codebase consistency.
- `userguide-reviewer` - Review user guide content against actual system features.
- `cleanup-analyzer` - Analyze static analysis output, especially for `/cleanup`.

## Usage Notes

- Treat these workflows as Claude Code-specific unless the user explicitly asks to use them elsewhere.
- Codex should prefer the repo's canonical verifier in `.codex/verify.commands`.
- Keep durable architecture and implementation patterns in the relevant `docs/developer/` files, not in tool-specific command catalogs.

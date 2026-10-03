# Static Analysis

All static analysis tools configured in this app and how to use them.

## Quick Reference

| Tool           | Purpose                  | Command                   | In check:all |
| -------------- | ------------------------ | ------------------------- | ------------ |
| TypeScript     | Type checking            | `pnpm run typecheck`      | Yes          |
| ESLint         | Syntax, style, TS rules  | `pnpm run lint`           | Yes          |
| Prettier       | Code formatting          | `pnpm run format:check`   | Yes          |
| ast-grep       | Architecture patterns    | `pnpm run ast:lint`       | Yes          |
| React Compiler | Automatic memoization    | Build-time                | Yes          |
| cargo fmt      | Rust formatting          | `pnpm run rust:fmt:check` | Yes          |
| clippy         | Rust linting             | `pnpm run rust:clippy`    | Yes          |
| Vitest         | Frontend tests           | `pnpm run test:run`       | Yes          |
| cargo test     | Rust tests               | `pnpm run rust:test`      | Yes          |
| knip           | Unused code detection    | `pnpm run knip`           | No           |
| jscpd          | Duplicate code detection | `pnpm run jscpd`          | No           |

## Running All Checks

```bash
pnpm run check:all    # Must pass before commits
pnpm run fix:all      # Auto-fix what can be fixed
```

## Tool Details

### ESLint

Handles syntax, style, and TypeScript-specific rules.

```bash
pnpm run lint        # Check for issues
pnpm run lint:fix    # Auto-fix issues
```

Configuration in `eslint.config.js`.

### Prettier

Consistent code formatting.

```bash
pnpm run format:check   # Check formatting
pnpm run format         # Fix formatting
```

Configuration in `prettier.config.js`.

### ast-grep

Enforces architectural patterns ESLint can't detect. Catches violations like Zustand destructuring and hooks in wrong directories.

```bash
pnpm run ast:lint    # Scan for violations
pnpm run ast:fix     # Auto-fix where possible
```

**Key rules:**

- No Zustand destructuring (causes render cascades)
- Hooks must be in `hooks/` directory
- No store subscriptions in `lib/`

See [writing-ast-grep-rules.md](./writing-ast-grep-rules.md) for creating new rules.

### React Compiler

Handles memoization automatically at build time. You do **not** need to manually add:

- `useMemo` for computed values
- `useCallback` for function references
- `React.memo` for components

The compiler analyzes code and adds memoization where beneficial.

**Note:** The `getState()` pattern is still critical - it avoids store subscriptions, not memoization. See [state-management.md](./state-management.md).

### Rust Tooling

```bash
pnpm run rust:fmt:check   # Check formatting
pnpm run rust:fmt         # Fix formatting
pnpm run rust:clippy      # Lint with clippy
pnpm run rust:clippy:fix  # Auto-fix clippy warnings
pnpm run rust:test        # Run Rust tests
```

### knip (Periodic Cleanup)

Detects unused exports, dependencies, and files. Not in `check:all` - use periodically.

```bash
pnpm run knip
```

### jscpd (Periodic Cleanup)

Detects duplicated code blocks. Not in `check:all` - use periodically.

```bash
pnpm run jscpd
```

Use the `/cleanup` command for guided analysis and cleanup of both knip and jscpd findings.

## CI Integration

CI runs selected TypeScript/frontend, Rust clippy/tests, and Python lanes;
`check:all` is the broader local gate. See [testing.md](testing.md) for setup and
the separate sidecar lane. Run locally before pushing:

```bash
pnpm run check:all
```

## Adding New Rules

**ESLint:** Add rules to `eslint.config.js`

**ast-grep:** Create YAML files in `.ast-grep/rules/`. See [writing-ast-grep-rules.md](./writing-ast-grep-rules.md).

**Prettier:** Modify `prettier.config.js`

# Data Persistence

Patterns for saving and loading data to disk.

## Choosing a Storage Method

| Need               | Solution           | When to Use                                                           |
| ------------------ | ------------------ | --------------------------------------------------------------------- |
| App preferences    | Preferences System | Strongly-typed settings (theme, shortcuts)                            |
| Emergency recovery | Recovery System    | Crash recovery, backup before risky operations                        |
| Relational data    | SQLite             | User data requiring queries, relationships                            |
| External API data  | TanStack Query     | Remote data with caching (see [external-apis.md](./external-apis.md)) |

```
Need to persist data?
├─ App settings? → Preferences (Rust struct + TanStack Query)
├─ User data with queries/relationships? → SQLite (see below)
├─ Remote API data? → external-apis.md
└─ Emergency/crash recovery? → Recovery System
```

All data goes through Rust for type safety and security. Use TanStack Query on the frontend for loading states and cache invalidation.

## File Locations

```text
~/Library/Application Support/com.jobcommandcenter.app/  (macOS)
├── jcc.db                                    # SQLite database
├── preferences.json                          # App preferences
└── recovery/                                 # Emergency data
    └── *.json
```

## Atomic Write Pattern (Critical)

All file writes use atomic operations to prevent corruption:

```rust
// Write to temp file first, then rename (atomic)
let temp_path = file_path.with_extension("tmp");
std::fs::write(&temp_path, content)?;
std::fs::rename(&temp_path, &file_path)?;
```

**Why**: If the app crashes during write, you either have the old file or the new file - never a corrupted partial file.

## Preferences System

### Rust Side

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AppPreferences {
    pub theme: String,
    // Add new preferences here
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
        }
    }
}
```

### React Side

```typescript
// src/services/preferences.ts
export function usePreferences() {
  return useQuery({
    queryKey: ['preferences'],
    queryFn: async () => unwrapResult(await commands.loadPreferences()),
  })
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (preferences: AppPreferences) =>
      commands.savePreferences(preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })
}
```

## Emergency Recovery System

For saving data before crashes or risky operations:

```typescript
// Save emergency data
await commands.saveEmergencyData({
  filename: 'unsaved-work',
  data: { content: userContent, timestamp: Date.now() },
})

// Load on startup
const recoveryData = await commands.loadEmergencyData({
  filename: 'unsaved-work',
})
if (recoveryData.status === 'ok' && recoveryData.data) {
  // Show recovery dialog
}
```

Recovery files are automatically cleaned up after 7 days via `cleanupOldRecoveryFiles`.

## Adding New Persistent Data

### 1. Define Rust struct

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MyData {
    pub field: String,
}

impl Default for MyData {
    fn default() -> Self {
        Self { field: "default".to_string() }
    }
}
```

### 2. Add Tauri commands

Follow the pattern in `src-tauri/src/commands/preferences.rs`:

- `load_*` command with Default fallback
- `save_*` command with atomic write

### 3. Register commands

Add to `src-tauri/src/bindings.rs` and regenerate bindings:

```bash
pnpm run rust:bindings
```

### 4. Create React hooks

```typescript
export function useMyData() {
  return useQuery({
    queryKey: ['my-data'],
    queryFn: async () => unwrapResult(await commands.loadMyData()),
  })
}
```

## Security

### Filename Validation

Always validate filenames to prevent path traversal:

```rust
if filename.contains("..") || filename.contains("/") || filename.contains("\\") {
    return Err("Invalid filename".to_string());
}
```

### Directory Permissions

Use Tauri's `app_data_dir()` for safe storage locations - never write to arbitrary paths.

## SQLite Database

Job Command Center uses SQLite through `sqlx` for relational job-search data. The database is created at `app.path().app_data_dir()/jcc.db` during Tauri startup in `src-tauri/src/lib.rs`, then managed as a `SqlitePool` for Rust command handlers.

### What Uses SQLite

| Use Case                        | Recommendation     |
| ------------------------------- | ------------------ |
| Simple key-value settings       | Preferences System |
| Job records and status tracking | SQLite via `sqlx`  |
| Submissions and adapter results | SQLite via `sqlx`  |
| Follow-ups, prep tasks, notes   | SQLite via `sqlx`  |
| Analytics and dashboard queries | SQLite via `sqlx`  |

### Runtime Settings

The startup path applies these database settings before migrations run:

- `PRAGMA journal_mode=WAL` for better concurrent read/write behavior.
- `PRAGMA foreign_keys=ON` so relational constraints are enforced.
- `PRAGMA busy_timeout=5000` so short-lived writer contention retries before failing.

Migrations are idempotent SQL statements stored in `MIGRATIONS` in `src-tauri/src/lib.rs`. Startup runs them before managing the pool as Tauri state. Duplicate-column migration errors are skipped intentionally for additive migrations that may already be present.

### Architecture Pattern

Tauri commands wrap database operations, TanStack Query provides frontend caching.

```text
React Component -> TanStack Query -> Tauri Command (sqlx) -> SQLite
```

```rust
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

#[tauri::command]
#[specta::specta]
pub async fn get_jobs(app: AppHandle) -> Result<Vec<Job>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, Job>("SELECT * FROM jobs ORDER BY updated_at DESC")
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())
}
```

Initialize in `src-tauri/src/lib.rs`:

```rust
let db_path = app_data_dir.join("jcc.db");
let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

let pool = SqlitePoolOptions::new()
    .max_connections(5)
    .connect(&db_url)
    .await?;

sqlx::query("PRAGMA journal_mode=WAL").execute(&pool).await?;
sqlx::query("PRAGMA foreign_keys=ON").execute(&pool).await?;
sqlx::query("PRAGMA busy_timeout=5000").execute(&pool).await?;

for sql in MIGRATIONS {
    sqlx::query(sql).execute(&pool).await?;
}

app.manage(pool);
```

```typescript
// Frontend: TanStack Query for caching and loading states
export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: async () => unwrapResult(await commands.getItems()),
  })
}

export function useAddItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (item: CreateItem) => commands.addItem(item),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  })
}
```

### Migration Rules

- Run migrations at app startup before managing database state
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotent migrations
- Keep additive migrations safe to rerun; handle duplicate-column cases deliberately
- Keep SQLite access in Rust command modules using `sqlx::SqlitePool`

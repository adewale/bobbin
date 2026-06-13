/// <reference types="vite/client" />

/**
 * Applies the real checked-in D1 migration chain to a test database.
 *
 * The migration list is derived from migrations/*.sql at build time and the
 * drop list from sqlite_master at run time, so adding migration 0026 (or a
 * new table) is automatically reflected here — no hand-maintained mirror to
 * forget to update.
 */
const migrationModules = import.meta.glob("../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  const lines = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"));

  let current: string[] = [];
  let inTrigger = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) {
      inTrigger = true;
    }

    current.push(line);

    if (inTrigger) {
      if (/^END;\s*(--.*)?$/i.test(trimmed)) {
        statements.push(current.join("\n").trim());
        current = [];
        inTrigger = false;
      }
      continue;
    }

    if (trimmed.endsWith(";")) {
      statements.push(current.join("\n").trim());
      current = [];
    }
  }

  if (current.length > 0) {
    statements.push(current.join("\n").trim());
  }

  return statements;
}

const MIGRATIONS = Object.keys(migrationModules)
  .sort()
  .flatMap((path) => splitSqlStatements(migrationModules[path]));

if (MIGRATIONS.length === 0) {
  throw new Error("No migrations found under migrations/*.sql — the test schema would be empty");
}

// FTS5 shadow tables are managed by SQLite and dropped implicitly with
// their virtual table; attempting to drop them directly is an error.
function isFtsShadowTable(name: string): boolean {
  return /_fts_(data|idx|content|docsize|config)$/.test(name);
}

async function dropAllUserObjects(db: D1Database): Promise<void> {
  // ORDER BY rowid = creation order. D1 enforces foreign keys, and SQLite
  // checks them while emptying a dropped table, so tables must be dropped
  // children-first — i.e. in reverse creation order (migrations always
  // create a parent before any table referencing it).
  const objects = await db.prepare(
    `SELECT name, type FROM sqlite_master
     WHERE type IN ('table', 'trigger', 'view')
       AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       AND name NOT LIKE '\\_cf%' ESCAPE '\\'
       AND name != 'd1_migrations'
     ORDER BY rowid`
  ).all<{ name: string; type: string }>();

  const tablesNewestFirst = objects.results
    .filter((object) => object.type === "table" && !isFtsShadowTable(object.name))
    .reverse();
  const drops = [
    ...objects.results
      .filter((object) => object.type === "trigger")
      .map((object) => `DROP TRIGGER IF EXISTS "${object.name}"`),
    ...objects.results
      .filter((object) => object.type === "view")
      .map((object) => `DROP VIEW IF EXISTS "${object.name}"`),
    ...tablesNewestFirst.map((object) => `DROP TABLE IF EXISTS "${object.name}"`),
  ];
  if (drops.length > 0) {
    await db.batch(drops.map((sql) => db.prepare(sql)));
  }
}

export async function applyTestMigrations(db: D1Database): Promise<void> {
  await dropAllUserObjects(db);

  for (const sql of MIGRATIONS) {
    await db.prepare(sql).run();
  }

  await db.prepare("PRAGMA optimize;").run();
}

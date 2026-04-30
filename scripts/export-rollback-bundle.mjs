import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    remote: false,
    db: "bobbin-db",
    config: "wrangler.jsonc",
    persistTo: undefined,
    outdir: ".rollback-bundles",
    label: "snapshot",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--remote") {
      options.remote = true;
      continue;
    }
    if (arg === "--db") {
      options.db = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.config = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--persist-to") {
      options.persistTo = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--outdir") {
      options.outdir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--label") {
      options.label = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

function run(command, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
        return;
      }
      resolveResult({ stdout, stderr });
    });
  });
}

async function runJson(command, args) {
  const { stdout } = await run(command, args);
  return JSON.parse(stdout);
}

function buildExecuteArgs(options, sql) {
  const args = ["wrangler", "d1", "execute", options.db, "--config", options.config, "--json", "--command", sql];
  if (options.remote) {
    args.splice(4, 0, "--remote");
  } else if (options.persistTo) {
    args.splice(4, 0, "--persist-to", options.persistTo);
  } else {
    args.splice(4, 0, "--local");
  }
  return args;
}

function buildExportArgs(options, tableName, outputPath) {
  const args = ["wrangler", "d1", "export", options.db, "--config", options.config, `--table=${tableName}`, "--no-schema", `--output=${outputPath}`];
  if (options.remote) {
    args.splice(4, 0, "--remote");
  } else {
    args.splice(4, 0, "--local");
  }
  return args;
}

export function shouldSkipRollbackTable(name, sql) {
  if (name.startsWith("_cf_")) return { skip: true, reason: "reserved table" };
  if (name === "d1_migrations") return { skip: true, reason: "migration bookkeeping table" };
  if (/^chunks_fts(?:_|$)/.test(name)) return { skip: true, reason: "FTS shadow table" };
  if (/CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) return { skip: true, reason: "virtual table" };
  return { skip: false, reason: null };
}

export function buildRestoreOrder(tableNames, foreignKeysByTable) {
  const exported = new Set(tableNames);
  const childrenByParent = new Map();
  const dependencyCount = new Map(tableNames.map((name) => [name, 0]));

  for (const tableName of tableNames) {
    const foreignKeys = foreignKeysByTable[tableName] ?? [];
    for (const foreignKey of foreignKeys) {
      const parent = foreignKey.parentTable;
      if (!exported.has(parent)) continue;
      const children = childrenByParent.get(parent) ?? [];
      children.push(tableName);
      childrenByParent.set(parent, children);
      dependencyCount.set(tableName, (dependencyCount.get(tableName) ?? 0) + 1);
    }
  }

  const queue = tableNames.filter((name) => (dependencyCount.get(name) ?? 0) === 0).sort();
  const ordered = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(current);

    for (const child of childrenByParent.get(current) ?? []) {
      const nextCount = (dependencyCount.get(child) ?? 0) - 1;
      dependencyCount.set(child, nextCount);
      if (nextCount === 0) {
        queue.push(child);
        queue.sort();
      }
    }
  }

  if (ordered.length !== tableNames.length) {
    throw new Error("Could not derive a dependency-safe restore order for rollback bundle tables.");
  }

  return ordered;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.persistTo && !options.remote) {
    throw new Error("wrangler d1 export does not currently support --persist-to. Use the default local state or --remote.");
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bundleDir = resolve(options.outdir, `${timestamp}-${options.label}`);
  const tablesDir = join(bundleDir, "tables");
  mkdirSync(tablesDir, { recursive: true });

  const gitSha = (await run("git", ["rev-parse", "HEAD"]))?.stdout.trim();
  const schema = await runJson("npx", buildExecuteArgs(options,
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  ));
  const tables = schema?.[0]?.results ?? [];
  const foreignKeysByTable = {};
  const exportedTables = [];
  const skippedTables = [];

  for (const table of tables) {
    const name = table.name;
    const sql = String(table.sql ?? "");
    const skipDecision = shouldSkipRollbackTable(name, sql);
    if (skipDecision.skip) {
      skippedTables.push({ name, reason: skipDecision.reason });
      continue;
    }

    const outputPath = join(tablesDir, `${name}.sql`);
    const foreignKeys = await runJson("npx", buildExecuteArgs(options, `PRAGMA foreign_key_list(${name});`));
    foreignKeysByTable[name] = (foreignKeys?.[0]?.results ?? []).map((row) => ({
      parentTable: row.table,
    }));
    await run("npx", buildExportArgs(options, name, outputPath));
    exportedTables.push({ name, file: `tables/${basename(outputPath)}` });
  }

  const restoreOrder = buildRestoreOrder(exportedTables.map((table) => table.name), foreignKeysByTable);
  const restoreScript = restoreOrder.map((tableName) => {
    const file = exportedTables.find((table) => table.name === tableName)?.file;
    return `npx wrangler d1 execute ${options.db} --config ${options.config} ${options.remote ? "--remote" : "--local"} --file ${file}`;
  }).join("\n");

  const manifest = {
    kind: "rollback-bundle",
    generatedAt: new Date().toISOString(),
    gitSha,
    target: {
      db: options.db,
      config: options.config,
      remote: options.remote,
      persistTo: options.persistTo ?? null,
    },
    format: "table-level data-only exports",
    exportedTables,
    skippedTables,
    restoreOrder,
    restoreNotes: [
      "Restore into a fresh D1 database or an isolated clone; do not overwrite a live database in place.",
      "Re-apply migrations before importing these data-only table exports so indexes, triggers, and FTS virtual tables are recreated from code.",
      "Import exported table files after migrations in the dependency-safe restore order recorded in this bundle.",
      "FTS virtual tables and reserved/internal tables are intentionally skipped and must come from migrations, not exports.",
      "Cloudflare Worker rollbacks do not roll back D1 contents or bindings; coordinate code rollback separately.",
      "If you need full-product rollback, pair this bundle with a captured Worker version ID and the output of scripts/audit-invariant-metrics.mjs.",
    ],
  };

  writeFileSync(join(bundleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(bundleDir, "restore.sh"), `${restoreScript}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

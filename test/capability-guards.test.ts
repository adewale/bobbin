/**
 * Every optional-binding guard in src/ (`env.X && ...`, `!env.X`,
 * `if (env.X ...`) is a branch that only runs when the binding is, or is
 * not, configured. When the test runtime lacks a binding, the bound branch
 * is silently dead under test: semantic search went untested this way
 * (audit M14).
 *
 * This test enumerates the guards and requires each binding to be listed
 * below with the tests that run each side. A new guard fails here until
 * someone says how it is covered.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

// binding -> test files that exercise the bound and the unbound branch.
// "bound" files must reference the binding or rely on the config-level fake
// (vitest.config.ts); "unbound" files must set it to null/omit it.
const GUARDED_BINDINGS: Record<string, { bound: string[]; unbound: string[] }> = {
  AI: {
    bound: ["src/semantic-bindings.test.ts", "src/jobs/ingest-embeddings.test.ts", "src/services/llm-ingest.test.ts"],
    unbound: ["src/jobs/ingest.test.ts", "src/integration.test.ts"],
  },
  VECTORIZE: {
    bound: ["src/semantic-bindings.test.ts", "src/routes/search-quality.test.ts"],
    unbound: ["src/semantic-bindings.test.ts", "src/integration.test.ts"],
  },
  ENRICHMENT_QUEUE: {
    bound: ["src/jobs/queue-handler.test.ts"],
    unbound: ["src/audit-fixes.test.ts"],
  },
  ENRICHMENT_DLQ: {
    bound: ["src/jobs/queue-handler.test.ts"],
    unbound: ["src/jobs/queue-handler.test.ts"],
  },
  SEARCH_RATE_LIMIT: {
    bound: ["src/routes/search-quality.test.ts"],
    unbound: ["src/routes/search-topics.test.ts"],
  },
  ADMIN_SECRET: {
    bound: ["src/routes/api-ingest.test.ts"],
    unbound: ["src/audit-fixes.test.ts"],
  },
};

// `env.X`, `c.env.X`, `(env as any).X`, `(c.env as Bindings).X`
const ENV_REF = String.raw`(?:\(\s*(?:c\.)?env\s+as\s+[\w<>]+\s*\)|\b(?:c\.)?env)\.([A-Z][A-Z0-9_]*)`;
const GUARD_PATTERNS = [
  new RegExp(String.raw`(?:&&|\|\||\?)\s*` + ENV_REF, "g"),                  // ... && env.X
  new RegExp(String.raw`!\s*` + ENV_REF, "g"),                                 // !env.X
  new RegExp(String.raw`\bif\s*\(\s*` + ENV_REF, "g"),                        // if (env.X
  new RegExp(ENV_REF + String.raw`\s*(?:&&|\|\||\?\?|\?\.)`, "g"),           // env.X && / ?? / ?.
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function findGuardedBindings(files: Array<{ path: string; text: string }>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const { path, text } of files) {
    for (const pattern of GUARD_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        const where = `${path}:${line}`;
        found.set(match[1], [...(found.get(match[1]) ?? []), where]);
      }
    }
  }
  return found;
}

describe("optional-binding guards", () => {
  const files = sourceFiles(join(ROOT, "src")).map((path) => ({
    path: relative(ROOT, path),
    text: readFileSync(path, "utf8"),
  }));
  const guarded = findGuardedBindings(files);

  it("finds the guards it is meant to police", () => {
    // Precondition against a vacuous pass: the scan sees the known guards.
    expect(guarded.get("AI")?.some((w) => w.startsWith("src/routes/search.tsx"))).toBe(true);
    expect(guarded.get("VECTORIZE")?.some((w) => w.startsWith("src/routes/chunks.tsx"))).toBe(true);
  });

  it("detects each guard form on a planted example", () => {
    const planted = findGuardedBindings([{ path: "planted.ts", text: [
      "if (env.ONE && x) {}",
      "if (!c.env.TWO) return;",
      "const y = flag && env.THREE;",
      "env.FOUR?.send(msg);",
      "const z = env.FIVE ?? fallback;",
      "if (!(c.env as any).SIX) return;",
    ].join("\n") }]);
    expect([...planted.keys()].sort()).toEqual(["FIVE", "FOUR", "ONE", "SIX", "THREE", "TWO"]);
  });

  it("lists every guarded binding with the tests that cover both branches", () => {
    const unlisted = [...guarded.keys()].filter((name) => !(name in GUARDED_BINDINGS));
    expect(unlisted.map((name) => `${name} (guarded at ${guarded.get(name)!.join(", ")})`),
      "add these bindings to GUARDED_BINDINGS with the tests that run the bound and unbound branches",
    ).toEqual([]);
    const stale = Object.keys(GUARDED_BINDINGS).filter((name) => !guarded.has(name));
    expect(stale, "these bindings are no longer guarded in src/; remove them from GUARDED_BINDINGS").toEqual([]);
  });

  it("points at test files that exist and mention the binding", () => {
    const problems: string[] = [];
    for (const [name, { bound, unbound }] of Object.entries(GUARDED_BINDINGS)) {
      for (const file of [...bound, ...unbound]) {
        const path = join(ROOT, file);
        if (!existsSync(path)) problems.push(`${name}: ${file} does not exist`);
        else if (!readFileSync(path, "utf8").includes(name)) problems.push(`${name}: ${file} never mentions ${name}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("binds a fake for every remote-only binding in the workers-pool config", () => {
    const config = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
    for (const name of ["AI", "VECTORIZE"]) {
      expect(config, `vitest.config.ts must bind ${name} for the workers pool`).toMatch(new RegExp(`\\b${name}:\\s*\\{\\s*scriptName:`));
    }
  });
});

import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

interface Options {
  baseUrl: string;
  remote: boolean;
  db: string;
  config: string;
  skipInvariants: boolean;
  skipBrowser: boolean;
  skipProvenance: boolean;
}

interface BrowserPageResult {
  url: string;
  status: number | null;
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    baseUrl: "https://bobbin.adewale-883.workers.dev",
    remote: true,
    db: "bobbin-db",
    config: "wrangler.jsonc",
    skipInvariants: false,
    skipBrowser: false,
    skipProvenance: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1] || options.baseUrl;
      index += 1;
      continue;
    }
    if (arg === "--db") {
      options.db = argv[index + 1] || options.db;
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.config = argv[index + 1] || options.config;
      index += 1;
      continue;
    }
    if (arg === "--local") {
      options.remote = false;
      continue;
    }
    if (arg === "--remote") {
      options.remote = true;
      continue;
    }
    if (arg === "--skip-invariants") {
      options.skipInvariants = true;
      continue;
    }
    if (arg === "--skip-browser") {
      options.skipBrowser = true;
      continue;
    }
    if (arg === "--skip-provenance") {
      options.skipProvenance = true;
    }
  }

  return options;
}

function run(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
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
      resolve({ stdout, stderr });
    });
  });
}

async function runJson(command: string, args: string[]) {
  const { stdout } = await run(command, args);
  return JSON.parse(stdout);
}

async function findRepresentativeUrls(baseUrl: string): Promise<string[]> {
  const episodeHtml = await fetch(`${baseUrl}/episodes?health=1`).then((response) => response.text());
  const topicHtml = await fetch(`${baseUrl}/topics?health=1`).then((response) => response.text());
  const episodeHref = episodeHtml.match(/href="(\/episodes\/[^"]+)"/)?.[1] || null;
  const topicHref = topicHtml.match(/href="(\/topics\/[^"]+)"/)?.[1] || null;

  return [
    "/",
    "/episodes",
    "/topics",
    "/summaries",
    ...(episodeHref ? [episodeHref] : []),
    ...(topicHref ? [topicHref] : []),
  ];
}

async function runBrowserSmoke(baseUrl: string): Promise<BrowserPageResult[]> {
  const browser = await chromium.launch({ headless: true });
  const urls = await findRepresentativeUrls(baseUrl);
  const results: BrowserPageResult[] = [];

  try {
    for (const path of urls) {
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailures: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      page.on("requestfailed", (request) => {
        requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`);
      });

      const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      results.push({
        url: `${baseUrl}${path}`,
        status: response?.status() ?? null,
        consoleErrors,
        pageErrors,
        requestFailures,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: options.baseUrl,
      remote: options.remote,
      db: options.db,
      config: options.config,
    },
  };

  if (!options.skipProvenance) {
    try {
      result.provenance = await runJson("npx", ["tsx", "scripts/audit-provenance.ts"]);
    } catch (error) {
      result.provenanceError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!options.skipInvariants) {
    try {
      const args = ["scripts/audit-invariant-metrics.mjs"];
      if (options.remote) args.push("--remote");
      else args.push("--local");
      args.push("--db", options.db, "--config", options.config);
      result.invariants = await runJson("node", args);
    } catch (error) {
      result.invariantsError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!options.skipBrowser) {
    try {
      result.browser = await runBrowserSmoke(options.baseUrl);
    } catch (error) {
      result.browserError = error instanceof Error ? error.message : String(error);
    }
  }

  const provenanceHealthy = options.skipProvenance
    ? true
    : result.provenance
      ? Boolean((result.provenance as any).allTitlesLookKomoroske)
      : false;
  const invariantsHealthy = options.skipInvariants
    ? true
    : result.invariants
      ? Number((result.invariants as any)?.counts?.orphan_topics ?? 0) === 0
        && Number((result.invariants as any)?.counts?.stale_usage_orphans ?? 0) === 0
        && Number((result.invariants as any)?.counts?.drifted_episode_chunk_counts ?? 0) === 0
      : false;
  const browserHealthy = options.skipBrowser
    ? true
    : Array.isArray(result.browser)
      ? (result.browser as BrowserPageResult[]).every((entry) => entry.status === 200 && entry.consoleErrors.length === 0 && entry.pageErrors.length === 0 && entry.requestFailures.length === 0)
      : false;

  result.healthy = provenanceHealthy && invariantsHealthy && browserHealthy;
  console.log(JSON.stringify(result, null, 2));
  if (!result.healthy) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

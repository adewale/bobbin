import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * AI-powered visual verification tests using agent-browser.
 *
 * These tests complement the DOM-based assertions in smoke.spec.ts and
 * navigation.spec.ts by asking an AI model to evaluate the *visual*
 * quality of each page (layout, readability, design coherence).
 *
 * Prerequisites:
 *   1. agent-browser installed:  npm install -D agent-browser
 *   2. Chrome available:         npx agent-browser install
 *   3. AI Gateway key set:       export AI_GATEWAY_API_KEY=gw_...
 *      (optionally override model with AI_GATEWAY_MODEL)
 *
 * Run with:  npm run test:visual
 */

// Resolve the agent-browser binary from the local node_modules
const AGENT_BROWSER = resolve(
  import.meta.dirname ?? ".",
  "../node_modules/.bin/agent-browser"
);

const BASE_URL =
  process.env.BASE_URL || "https://bobbin.adewale-883.workers.dev";

// Session name isolates these tests from other agent-browser usage
const SESSION = "bobbin-visual-tests";

/**
 * Run an agent-browser command and return its stdout.
 * Commands are run with --json for machine-readable output where useful.
 */
function ab(args: string[], { json = false } = {}): string {
  const fullArgs = ["--session", SESSION, ...(json ? ["--json"] : []), ...args];
  return execFileSync(AGENT_BROWSER, fullArgs, {
    encoding: "utf-8",
    timeout: 60_000,
    env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "30000" },
  }).trim();
}

/**
 * Ask the AI a question about the currently open page and return its answer.
 * Uses agent-browser's `chat` command which takes a screenshot, reads the
 * accessibility tree, and sends both to the AI model for evaluation.
 */
function askAI(question: string): string {
  return ab(["chat", question]);
}

// ── Setup & teardown ────────────────────────────────────────────────────

test.beforeAll(() => {
  // Verify the AI gateway key is set
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "AI_GATEWAY_API_KEY environment variable is required for visual tests.\n" +
        "Set it to your Vercel AI Gateway key: export AI_GATEWAY_API_KEY=gw_..."
    );
  }
});

test.afterAll(() => {
  try {
    ab(["close", "--all"]);
  } catch {
    // Ignore errors on cleanup
  }
});

// Run visual tests serially — they share a single browser session
test.describe.configure({ mode: "serial" });

// ── Visual tests ────────────────────────────────────────────────────────

test.describe("Visual: Homepage", () => {
  test("looks like a well-designed content archive", async () => {
    ab(["open", `${BASE_URL}/`]);
    ab(["wait", "--load", "networkidle"]);

    const answer = askAI(
      "Does this page look like a well-designed content archive? " +
        "Are there any visual issues like overlapping text, broken layouts, " +
        "or missing content? Answer YES if it looks good, NO if there are " +
        "problems. Then briefly explain what you see."
    );

    console.log("AI assessment (homepage):", answer);

    // The AI should not report major visual problems
    const lower = answer.toLowerCase();
    expect(
      lower.includes("yes") || lower.includes("looks good"),
      `AI reported visual issues on homepage: ${answer}`
    ).toBeTruthy();
  });
});

test.describe("Visual: Chunk detail", () => {
  test("provides a good reading experience", async () => {
    // Navigate to the browse page and then into a chunk
    ab(["open", `${BASE_URL}/episodes`]);
    ab(["wait", "--load", "networkidle"]);

    // Click the first episode link
    ab(["find", "first", 'a[href^="/episodes/"]', "click"]);
    ab(["wait", "--load", "networkidle"]);

    // Now find and click a chunk link
    ab(["find", "first", 'a[href^="/chunks/"]', "click"]);
    ab(["wait", "--load", "networkidle"]);

    const answer = askAI(
      "Is the reading experience good on this page? Is the text readable " +
        "with appropriate font size and line height? Are there margin notes " +
        "or annotations, and if so are they properly positioned without " +
        "overlapping the main text? Answer YES if the reading experience " +
        "is good, NO if there are problems. Then briefly explain."
    );

    console.log("AI assessment (chunk detail):", answer);

    const lower = answer.toLowerCase();
    expect(
      lower.includes("yes") || lower.includes("readable"),
      `AI reported reading experience issues: ${answer}`
    ).toBeTruthy();
  });
});

test.describe("Visual: Word Stats", () => {
  test("data visualization is clear and understandable", async () => {
    ab(["open", `${BASE_URL}/word-stats`]);
    ab(["wait", "--load", "networkidle"]);

    const answer = askAI(
      "Is the data visualization on this word stats page clear? " +
        "Can I understand what the most distinctive words are? Is the " +
        "information well-organized and easy to scan? Answer YES if the " +
        "visualization is clear, NO if there are problems. Then briefly explain."
    );

    console.log("AI assessment (word-stats):", answer);

    const lower = answer.toLowerCase();
    expect(
      lower.includes("yes") || lower.includes("clear"),
      `AI reported visualization issues on word-stats: ${answer}`
    ).toBeTruthy();
  });
});

test.describe("Visual: Browse page on mobile", () => {
  test("is readable on a small screen with a compact header", async () => {
    // Set a mobile viewport
    ab(["set", "viewport", "393", "852"]);
    ab(["open", `${BASE_URL}/episodes`]);
    ab(["wait", "--load", "networkidle"]);

    const answer = askAI(
      "This page is displayed on a mobile viewport (393x852). " +
        "Does the header fit in one line without wrapping or overflowing? " +
        "Is the content readable on this small screen? Are there any " +
        "horizontal scrolling issues or text that's too small to read? " +
        "Answer YES if it looks good on mobile, NO if there are problems. " +
        "Then briefly explain."
    );

    console.log("AI assessment (browse mobile):", answer);

    const lower = answer.toLowerCase();
    expect(
      lower.includes("yes") || lower.includes("looks good"),
      `AI reported mobile layout issues: ${answer}`
    ).toBeTruthy();
  });
});

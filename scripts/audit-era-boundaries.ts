// One-shot corpus sanity-check for the proposed AI-history era boundaries.
//
// Reads the raw HTML files under data/raw/, parses them with the same
// `parseHtmlDocument` the production pipeline uses, and reports:
//   1. Date distribution of episodes (do the proposed era boundaries fall
//      where the corpus actually has content?)
//   2. First-appearance month for marker terms drawn from the proposed
//      eras (GPT-3, ChatGPT, Claude, agent, etc.)
//   3. Per-quarter mention counts for those marker terms (does the corpus
//      surge match the proposed era windows?)
//
// Run: npx tsx scripts/audit-era-boundaries.ts
//
// Not part of the production build; intended as a research artifact.

import { readFileSync, readdirSync } from "node:fs";
import { parseHtmlDocument } from "../src/services/html-parser";

type Marker = { label: string; era: string; pattern: RegExp };

// Markers chosen to map onto the proposed eras from the research agent.
// Each pattern uses word boundaries where possible to avoid false positives.
const MARKERS: Marker[] = [
  // Scaling Hypothesis era (mid-2020 → late 2022)
  { label: "GPT-3",            era: "Scaling",     pattern: /\bGPT-?3\b/i },
  { label: "Copilot",          era: "Scaling",     pattern: /\bcopilot\b/i },
  { label: "DALL-E",           era: "Scaling",     pattern: /\bDALL[·•·\-·\.]?E\b/i },
  { label: "Stable Diffusion", era: "Scaling",     pattern: /\bstable diffusion\b/i },
  { label: "Midjourney",       era: "Scaling",     pattern: /\bmidjourney\b/i },

  // ChatGPT Shock (Dec 2022 → mid-2023)
  { label: "ChatGPT",          era: "Shock",       pattern: /\bchatgpt\b/i },
  { label: "GPT-4",            era: "Shock",       pattern: /\bGPT-?4\b/i },
  { label: "Claude",           era: "Shock",       pattern: /\bclaude\b/i },

  // Foundation Model Plateau / Tooling Bloom (mid-2023 → mid-2024)
  { label: "Llama",            era: "Plateau",     pattern: /\bllama\b/i },
  { label: "RAG",              era: "Plateau",     pattern: /\bRAG\b/ },
  { label: "vector",           era: "Plateau",     pattern: /\bvector(?:s| db| database)?\b/i },
  { label: "fine-tun",         era: "Plateau",     pattern: /\bfine[- ]?tun(?:e|ing)\b/i },
  { label: "open weights",     era: "Plateau",     pattern: /\bopen[- ]weights?\b/i },

  // Reasoning Turn (Sep 2024 → early 2025)
  { label: "reasoning",        era: "Reasoning",   pattern: /\breasoning\b/i },
  { label: "o1 / o-series",    era: "Reasoning",   pattern: /\b(o1|o-?series)\b/i },
  { label: "DeepSeek",         era: "Reasoning",   pattern: /\bdeepseek\b/i },
  { label: "inference-time",   era: "Reasoning",   pattern: /\binference[- ]time\b/i },

  // Agent Era (early 2025 → present)
  { label: "agent",            era: "Agent",       pattern: /\bagent(?:s|ic)?\b/i },
  { label: "Claude Code",      era: "Agent",       pattern: /\bclaude code\b/i },
  { label: "Cursor",           era: "Agent",       pattern: /\bcursor\b/i },
  { label: "vibe coding",      era: "Agent",       pattern: /\bvibe[- ]coding\b/i },
  { label: "swarm",            era: "Agent",       pattern: /\b(?:agent )?swarm(?:s)?\b/i },

  // Cross-cutting / control terms (no specific era association)
  { label: "LLM(s)",           era: "Control",     pattern: /\bLLMs?\b/ },
  { label: "OpenAI",           era: "Control",     pattern: /\bopenai\b/i },
  { label: "Anthropic",        era: "Control",     pattern: /\banthropic\b/i },
];

type EpisodeRecord = {
  date: string; // ISO YYYY-MM-DD
  year: number;
  month: number;
  quarter: string; // YYYY-QN
  text: string;
  chunkCount: number;
};

function quarterOf(year: number, month: number): string {
  return `${year}-Q${Math.ceil(month / 3)}`;
}

function loadEpisodes(): EpisodeRecord[] {
  const dir = "./data/raw";
  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  const all: EpisodeRecord[] = [];
  const seenDates = new Set<string>();

  for (const file of files) {
    const html = readFileSync(`${dir}/${file}`, "utf-8");
    const parsed = parseHtmlDocument(html);
    for (const ep of parsed) {
      const iso = ep.parsedDate.toISOString().slice(0, 10);
      // Two source files often duplicate older episodes; keep first occurrence
      if (seenDates.has(iso)) continue;
      seenDates.add(iso);
      const year = ep.parsedDate.getUTCFullYear();
      const month = ep.parsedDate.getUTCMonth() + 1;
      const text = ep.chunks.map((c) => c.contentPlain).join("\n");
      all.push({
        date: iso,
        year,
        month,
        quarter: quarterOf(year, month),
        text,
        chunkCount: ep.chunks.length,
      });
    }
  }

  return all.sort((a, b) => a.date.localeCompare(b.date));
}

function reportEpisodeDistribution(eps: EpisodeRecord[]) {
  console.log("\n=== Episode date distribution ===");
  console.log(`Total episodes: ${eps.length}`);
  console.log(`Range: ${eps[0]?.date} → ${eps[eps.length - 1]?.date}`);
  console.log(`Total chunks: ${eps.reduce((sum, e) => sum + e.chunkCount, 0)}`);

  const byYear = new Map<number, number>();
  for (const ep of eps) byYear.set(ep.year, (byYear.get(ep.year) ?? 0) + 1);
  console.log("\nEpisodes per year:");
  for (const [year, count] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${year}: ${"#".repeat(count)} ${count}`);
  }
}

function reportFirstAppearance(eps: EpisodeRecord[]) {
  console.log("\n=== First appearance of marker terms ===");
  const firstSeen = new Map<string, EpisodeRecord>();
  for (const ep of eps) {
    for (const m of MARKERS) {
      if (firstSeen.has(m.label)) continue;
      if (m.pattern.test(ep.text)) firstSeen.set(m.label, ep);
    }
  }

  const rows: Array<{ label: string; era: string; date: string }> = [];
  for (const m of MARKERS) {
    const seen = firstSeen.get(m.label);
    rows.push({
      label: m.label,
      era: m.era,
      date: seen ? seen.date : "(not found)",
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  for (const row of rows) {
    console.log(`  ${row.date.padEnd(14)} ${row.era.padEnd(10)} ${row.label}`);
  }
}

function reportQuarterlyCounts(eps: EpisodeRecord[]) {
  console.log("\n=== Quarterly mention counts ===");
  const quarters = new Set<string>();
  for (const ep of eps) quarters.add(ep.quarter);
  const sortedQuarters = [...quarters].sort();

  // For each marker, build a sparkline-style view across quarters
  const maxLabelLen = Math.max(...MARKERS.map((m) => m.label.length));
  const quartersHeader = sortedQuarters.map((q) => q.slice(2)).join(" "); // YY-QN
  console.log(`  ${"label".padEnd(maxLabelLen)}  era       ${quartersHeader}`);
  console.log(`  ${"".padEnd(maxLabelLen, "-")}  --------- ${"-".repeat(quartersHeader.length)}`);

  const totals = new Map<string, Map<string, number>>(); // marker -> quarter -> count

  for (const m of MARKERS) {
    const counts = new Map<string, number>();
    for (const ep of eps) {
      const matches = ep.text.match(new RegExp(m.pattern.source, m.pattern.flags + (m.pattern.flags.includes("g") ? "" : "g")));
      const n = matches ? matches.length : 0;
      counts.set(ep.quarter, (counts.get(ep.quarter) ?? 0) + n);
    }
    totals.set(m.label, counts);
  }

  // Print one row per marker, with counts bucketed into severity bins
  function bucket(n: number): string {
    if (n === 0) return ".";
    if (n < 3) return "▁";
    if (n < 10) return "▃";
    if (n < 30) return "▅";
    if (n < 100) return "▇";
    return "█";
  }

  for (const m of MARKERS) {
    const counts = totals.get(m.label)!;
    const sparkline = sortedQuarters.map((q) => bucket(counts.get(q) ?? 0)).join("  ");
    console.log(`  ${m.label.padEnd(maxLabelLen)}  ${m.era.padEnd(9)} ${sparkline}`);
  }

  console.log("\nLegend: . = 0   ▁ = 1-2   ▃ = 3-9   ▅ = 10-29   ▇ = 30-99   █ = 100+");
}

function reportEraSpikeAlignment(eps: EpisodeRecord[]) {
  console.log("\n=== Era spike alignment ===");
  // For each proposed era, identify the quarters within its window and
  // compute total mention counts of its markers vs total in other quarters.
  const windows: Record<string, { start: string; end: string; markers: Marker[] }> = {
    Scaling:   { start: "2020-Q3", end: "2022-Q4", markers: MARKERS.filter((m) => m.era === "Scaling") },
    Shock:     { start: "2022-Q4", end: "2023-Q3", markers: MARKERS.filter((m) => m.era === "Shock") },
    Plateau:   { start: "2023-Q3", end: "2024-Q3", markers: MARKERS.filter((m) => m.era === "Plateau") },
    Reasoning: { start: "2024-Q3", end: "2025-Q1", markers: MARKERS.filter((m) => m.era === "Reasoning") },
    Agent:     { start: "2025-Q1", end: "2026-Q4", markers: MARKERS.filter((m) => m.era === "Agent") },
  };

  for (const [era, window] of Object.entries(windows)) {
    if (window.markers.length === 0) continue;
    let inside = 0;
    let outside = 0;
    for (const ep of eps) {
      const within = ep.quarter >= window.start && ep.quarter <= window.end;
      let count = 0;
      for (const m of window.markers) {
        const matches = ep.text.match(new RegExp(m.pattern.source, m.pattern.flags.replace("g", "") + "g"));
        count += matches ? matches.length : 0;
      }
      if (within) inside += count;
      else outside += count;
    }
    const total = inside + outside;
    const pct = total > 0 ? Math.round((inside / total) * 100) : 0;
    console.log(`  ${era.padEnd(10)} window ${window.start}–${window.end}: ${inside} mentions inside, ${outside} outside (${pct}% concentrated in window)`);
  }
}

function main() {
  const eps = loadEpisodes();
  if (eps.length === 0) {
    console.error("No episodes parsed from data/raw/. Have the source HTML files been fetched?");
    process.exit(1);
  }

  reportEpisodeDistribution(eps);
  reportFirstAppearance(eps);
  reportQuarterlyCounts(eps);
  reportEraSpikeAlignment(eps);
}

main();

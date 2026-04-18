import { slugify } from "../lib/slug";
import { normalizeChunkText } from "./analysis-text";
import type { Bindings } from "../types";

export const LLM_EXTRACTOR_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const LLM_PROMPT_VERSION = "episode-candidates-v1";
export const LLM_SCHEMA_VERSION = "1";

export interface EpisodeLlmChunkInput {
  id?: number;
  slug: string;
  title: string;
  contentPlain: string;
}

export interface EpisodeLlmInput {
  episodeId: number;
  episodeSlug: string;
  title: string;
  normalizedText: string;
  chunks: EpisodeLlmChunkInput[];
}

export interface EpisodeLlmEvidence {
  chunkSlug: string;
  quote: string;
}

export interface EpisodeLlmCandidate {
  name: string;
  slug: string;
  kind: "entity" | "phrase" | "concept";
  confidence: number;
  rankPosition: number;
  aliases: string[];
  evidence: EpisodeLlmEvidence[];
}

function extractResponseText(result: any): string {
  function deepSearch(value: unknown, depth: number): string | null {
    if (depth > 6 || value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) return value;
      return null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deepSearch(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        const found = deepSearch(entry, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result?.response === "string") return result.result.response;
  if (typeof result?.output_text === "string") return result.output_text;
  if (typeof result?.text === "string") return result.text;
  if (typeof result?.result?.text === "string") return result.result.text;
  if (typeof result?.content === "string") return result.content;
  if (typeof result?.result?.content === "string") return result.result.content;
  if (Array.isArray(result?.choices) && typeof result.choices[0]?.message?.content === "string") {
    return result.choices[0].message.content;
  }
  if (Array.isArray(result?.response) && typeof result.response[0]?.content?.[0]?.text === "string") {
    return result.response[0].content[0].text;
  }
  if (Array.isArray(result?.output) && typeof result.output[0]?.content?.[0]?.text === "string") {
    return result.output[0].content[0].text;
  }
  if (Array.isArray(result?.result?.output) && typeof result.result.output[0]?.content?.[0]?.text === "string") {
    return result.result.output[0].content[0].text;
  }
  if (Array.isArray(result?.result?.response) && typeof result.result.response[0]?.content?.[0]?.text === "string") {
    return result.result.response[0].content[0].text;
  }
  const discovered = deepSearch(result, 0);
  if (discovered) return discovered;
  throw new Error("Unsupported Workers AI response format");
}

export function buildEpisodeLlmMessages(input: EpisodeLlmInput) {
  const chunkLines = input.chunks.map((chunk) => ({
    slug: chunk.slug,
    title: chunk.title,
    text: normalizeChunkText(chunk.contentPlain).normalizedText,
  }));

  return [
    {
      role: "system",
      content: [
        "You propose episode-level topic and entity candidates for a deterministic downstream pipeline.",
        "Return JSON only.",
        "Do not invent evidence. Use only the provided chunk text.",
        "Prefer durable entities, phrases, and concepts. Avoid generic discourse filler.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction: "Return { \"candidates\": [{name, kind, confidence, rank_position, aliases, evidence:[{chunk_slug, quote}]}] }",
        episode_slug: input.episodeSlug,
        episode_title: input.title,
        normalized_episode_text: input.normalizedText,
        chunks: chunkLines,
      }),
    },
  ];
}

export function parseEpisodeLlmResponse(raw: string, chunks: EpisodeLlmChunkInput[]): EpisodeLlmCandidate[] {
  const parsed = JSON.parse(raw);
  const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  const chunkSlugSet = new Set(chunks.map((chunk) => chunk.slug));
  const validated: EpisodeLlmCandidate[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const name = normalizeChunkText(String(candidate?.name || "")).normalizedText;
    const kind = candidate?.kind;
    if (!name || (kind !== "entity" && kind !== "phrase" && kind !== "concept")) continue;

    const evidence = Array.isArray(candidate?.evidence)
      ? candidate.evidence
          .map((entry: any) => ({
            chunkSlug: String(entry?.chunk_slug || ""),
            quote: normalizeChunkText(String(entry?.quote || "")).normalizedText,
          }))
          .filter((entry: EpisodeLlmEvidence) => entry.chunkSlug && entry.quote && chunkSlugSet.has(entry.chunkSlug))
      : [];

    if (evidence.length === 0) continue;

    validated.push({
      name,
      slug: slugify(name),
      kind,
      confidence: Math.max(0, Math.min(1, Number(candidate?.confidence ?? 0.5))),
      rankPosition: Number.isFinite(candidate?.rank_position) ? Number(candidate.rank_position) : index,
      aliases: Array.isArray(candidate?.aliases)
        ? candidate.aliases.map((alias: unknown) => normalizeChunkText(String(alias)).normalizedText).filter(Boolean)
        : [],
      evidence,
    });
  }

  return validated;
}

export async function generateEpisodeLlmCandidates(ai: Ai, input: EpisodeLlmInput): Promise<{ rawResponse: string; candidates: EpisodeLlmCandidate[] }> {
  const result = await ai.run(LLM_EXTRACTOR_MODEL as any, {
    messages: buildEpisodeLlmMessages(input),
    temperature: 0,
  } as any);
  const rawResponse = extractResponseText(result);
  return {
    rawResponse,
    candidates: parseEpisodeLlmResponse(rawResponse, input.chunks),
  };
}

export async function persistEpisodeLlmCandidates(
  db: D1Database,
  sourceId: number,
  episodeId: number,
  rawResponse: string,
  candidates: EpisodeLlmCandidate[],
  chunkIdBySlug: Map<string, number>,
): Promise<void> {
  await db.prepare("DELETE FROM llm_enrichment_runs WHERE episode_id = ?").bind(episodeId).run();

  const run = await db.prepare(
    `INSERT INTO llm_enrichment_runs (source_id, episode_id, extractor_model, prompt_version, schema_version, status, raw_response_json)
     VALUES (?, ?, ?, ?, ?, 'completed', ?)`
  ).bind(sourceId, episodeId, LLM_EXTRACTOR_MODEL, LLM_PROMPT_VERSION, LLM_SCHEMA_VERSION, rawResponse).run();
  const runId = Number(run.meta.last_row_id);

  for (const candidate of candidates) {
    const inserted = await db.prepare(
      `INSERT INTO llm_episode_candidates (
         run_id, episode_id, candidate_name, normalized_name, slug, kind, confidence, rank_position, aliases_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      runId,
      episodeId,
      candidate.name,
      candidate.name,
      candidate.slug,
      candidate.kind,
      candidate.confidence,
      candidate.rankPosition,
      JSON.stringify(candidate.aliases),
    ).run();
    const candidateId = Number(inserted.meta.last_row_id);
    for (const evidence of candidate.evidence) {
      const chunkId = chunkIdBySlug.get(evidence.chunkSlug);
      if (!chunkId) continue;
      await db.prepare(
        `INSERT INTO llm_episode_candidate_evidence (candidate_id, chunk_id, chunk_slug, quote)
         VALUES (?, ?, ?, ?)`
      ).bind(candidateId, chunkId, evidence.chunkSlug, evidence.quote).run();
    }
  }
}

export async function enrichEpisodesWithLlm(env: Bindings, sourceId: number, episodes: Array<{
  id: number;
  slug: string;
  title: string;
  chunks: EpisodeLlmChunkInput[];
}>): Promise<void> {
  if (!env.AI || episodes.length === 0) return;

  for (const episode of episodes) {
    const normalizedText = normalizeChunkText(episode.chunks.map((chunk) => chunk.contentPlain).join(" ")).normalizedText;
    const llmResult = await generateEpisodeLlmCandidates(env.AI, {
      episodeId: episode.id,
      episodeSlug: episode.slug,
      title: episode.title,
      normalizedText,
      chunks: episode.chunks,
    });
    await persistEpisodeLlmCandidates(
      env.DB,
      sourceId,
      episode.id,
      llmResult.rawResponse,
      llmResult.candidates,
      new Map(episode.chunks.filter((chunk) => chunk.id).map((chunk) => [chunk.slug, chunk.id as number])),
    );
  }
}

export async function loadLlmBoostsForChunks(
  db: D1Database,
  chunkIds: number[],
): Promise<Map<number, Map<string, { confidence: number; kind: string; candidateName: string }>>> {
  if (chunkIds.length === 0) return new Map();
  const boosts = new Map<number, Map<string, { confidence: number; kind: string; candidateName: string }>>();
  const BATCH = 90;
  for (let i = 0; i < chunkIds.length; i += BATCH) {
    const batch = chunkIds.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const rows = await db.prepare(
      `SELECT e.chunk_id, c.slug, c.candidate_name, c.kind, c.confidence
       FROM llm_episode_candidate_evidence e
       JOIN llm_episode_candidates c ON c.id = e.candidate_id
       WHERE e.chunk_id IN (${placeholders})`
    ).bind(...batch).all<{ chunk_id: number; slug: string; candidate_name: string; kind: string; confidence: number }>();
    for (const row of rows.results) {
      const chunkBoosts = boosts.get(row.chunk_id) || new Map();
      chunkBoosts.set(row.slug, { confidence: row.confidence, kind: row.kind, candidateName: row.candidate_name });
      boosts.set(row.chunk_id, chunkBoosts);
    }
  }
  return boosts;
}

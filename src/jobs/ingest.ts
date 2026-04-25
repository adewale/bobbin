import { slugify } from "../lib/slug";
import { formatDate } from "../lib/date";
import { countWords } from "../lib/text";
import { batchExec, chunkForSqlBindings, sqlPlaceholders } from "../lib/db";
import { persistEpisodeArtifactChunks } from "../db/artifacts";
import {
  buildPhraseLexicon,
  decideCandidateDecisions,
  extractCandidateDecisions,
  extractHeuristicPhraseCandidates,
  extractTopicCandidates,
  type CandidateDecision,
  normalizeTerm,
} from "../services/topic-extractor";
import {
  CURRENT_NORMALIZATION_VERSION,
  countTokenFrequencies,
  normalizeChunkText,
  tokenizeNormalizedText,
} from "../services/analysis-text";
import { rebuildWordStatsAggregates } from "../services/word-stats";
import { extractCorpusNgrams } from "../services/ngram-extractor";
import { extractPMIPhrases } from "../services/pmi-phrases";
import { computeTopicDisplayDecisions, isNoiseTopic } from "../services/topic-quality";
import { getCandidatePromotionReason, getCorpusPriorRejectionReason, getPhrasePromotionReason } from "../services/pipeline-tuning";
import { generateEmbeddings } from "../services/embeddings";
import { enrichEpisodesWithLlm, loadLlmBoostsForChunks } from "../services/llm-ingest";
import { normalizeTopicExtractorMode, type TopicExtractorMode } from "../services/yake-runtime";
import { getExistingDatesForSource, getSourceTag } from "../db/sources";
import { getUnenrichedChunks, markChunksEnriched, isEnrichmentDone } from "../db/ingestion";
import type { Bindings, ParsedChunk, ParsedEpisode, RichBlock, RichLink, RichTextNode } from "../types";

/** Current enrichment algorithm version. Bump to re-enrich all chunks.
 * v1: Initial TF-IDF extraction (maxTopics=15, no noise filter on heuristics)
 * v2: Quality improvements — maxTopics=10, noise filter on all sources
 * v3: Batched finalization, clean old chunk_topics during re-enrichment
 * v4: YAKE replaces TF-IDF (5 keyphrases/chunk), df≥5 gate, stem merge,
 *     similarity clustering, orphan topic deletion
 * v5: staged topic pipeline with normalized analysis text, phrase lexicon,
 *     candidate provenance, early rejection, and persisted display flags
 */
export const CURRENT_ENRICHMENT_VERSION = 5;

export interface PipelineAuditSample {
  chunk_id: number;
  source: string;
  raw_candidate: string;
  normalized_candidate: string;
  decision: string;
  decision_reason: string;
}

export interface PipelineStageResult {
  name: string;
  duration_ms: number;
  status: "ok" | "error";
  counts: Record<string, number>;
  detail?: string;
  error?: string;
}

export interface ProcessChunkBatchResult {
  extractorMode: TopicExtractorMode;
  chunksProcessed: number;
  candidatesGenerated: number;
  candidatesRejectedEarly: number;
  candidatesInserted: number;
  topicsInserted: number;
  chunkTopicLinksInserted: number;
  chunkWordRowsInserted: number;
  stageResults: PipelineStageResult[];
  auditReport: PipelineAuditSample[];
}

export interface IngestParsedEpisodesResult {
  episodesAdded: number;
  chunksAdded: number;
  enrichBatch?: ProcessChunkBatchResult;
  finalize?: FinalizeResult;
}

export interface InsertedEpisodeArtifact {
  id: number;
  slug: string;
  title: string;
  chunks: Array<{ id: number; slug: string; title: string; contentPlain: string; linkCount: number; imageCount: number; maxDepth: number; formattingHints: string[] }>;
}

export interface BackfilledEpisodeArtifact extends InsertedEpisodeArtifact {
  updatedChunks: number[];
}

type StoredParsedChunk = ParsedChunk & {
  slug: string;
  richContent: RichBlock[];
};

type StoredParsedEpisode = ParsedEpisode & {
  slug: string;
  richContent: RichBlock[];
  storedChunks: StoredParsedChunk[];
};

function resolveInternalFragmentHref(href: string, anchorTargetById: Map<string, string>): string {
  if (!href.startsWith("#") || href.startsWith("#cmnt")) return href;
  return anchorTargetById.get(href.slice(1)) || href;
}

function resolveInternalFragmentLinks(links: RichLink[], anchorTargetById: Map<string, string>): RichLink[] {
  return links.map((link) => ({
    ...link,
    href: resolveInternalFragmentHref(link.href, anchorTargetById),
  }));
}

function resolveInternalFragmentNodes(nodes: RichTextNode[], anchorTargetById: Map<string, string>): RichTextNode[] {
  return nodes.map((node) => {
    if (node.type !== "text" || !node.href) return node;
    return {
      ...node,
      href: resolveInternalFragmentHref(node.href, anchorTargetById),
    };
  });
}

function resolveInternalFragmentBlocks(blocks: RichBlock[], anchorTargetById: Map<string, string>): RichBlock[] {
  return blocks.map((block) => ({
    ...block,
    nodes: resolveInternalFragmentNodes(block.nodes, anchorTargetById),
  }));
}

function resolveInternalFragmentMarkdown(markdown: string, anchorTargetById: Map<string, string>): string {
  return markdown.replace(/\]\(#(?!cmnt)([^)]+)\)/g, (match, anchorId) => {
    const resolvedHref = anchorTargetById.get(String(anchorId));
    return resolvedHref ? `](${resolvedHref})` : match;
  });
}

function buildStoredEpisodes(
  episodes: ParsedEpisode[],
  getEpisodeSlug: (episode: ParsedEpisode) => string,
  getChunkSlug: (episode: ParsedEpisode, episodeSlug: string, chunk: ParsedChunk) => string,
): StoredParsedEpisode[] {
  const storedEpisodes = episodes.map((episode) => {
    const episodeSlug = getEpisodeSlug(episode);
    const storedChunks = episode.chunks.map((chunk) => {
      const chunkSlug = getChunkSlug(episode, episodeSlug, chunk);
      return {
        ...chunk,
        slug: chunkSlug,
        richContent: chunk.richContent.map((block) => ({
          ...block,
          chunkSlug,
          chunkTitle: chunk.title,
          chunkPosition: chunk.position,
        })),
      };
    });

    return {
      ...episode,
      slug: episodeSlug,
      richContent: storedChunks.flatMap((chunk) => chunk.richContent),
      storedChunks,
    };
  });

  const anchorTargetById = new Map<string, string>();
  for (const episode of storedEpisodes) {
    for (const chunk of episode.storedChunks) {
      for (const block of chunk.richContent) {
        for (const anchorId of block.anchorIds || []) {
          anchorTargetById.set(anchorId, `/chunks/${chunk.slug}#${anchorId}`);
        }
      }
    }
  }

  return storedEpisodes.map((episode) => {
    const storedChunks = episode.storedChunks.map((chunk) => ({
      ...chunk,
      contentMarkdown: resolveInternalFragmentMarkdown(chunk.contentMarkdown, anchorTargetById),
      richContent: resolveInternalFragmentBlocks(chunk.richContent, anchorTargetById),
      links: resolveInternalFragmentLinks(chunk.links, anchorTargetById),
    }));

    return {
      ...episode,
      contentMarkdown: resolveInternalFragmentMarkdown(episode.contentMarkdown, anchorTargetById),
      richContent: storedChunks.flatMap((chunk) => chunk.richContent),
      links: resolveInternalFragmentLinks(episode.links, anchorTargetById),
      storedChunks,
    };
  });
}

async function runPipelineStage(
  name: string,
  results: PipelineStageResult[],
  fn: () => Promise<{ counts?: Record<string, number>; detail?: string } | void>
): Promise<{ counts: Record<string, number>; detail?: string }> {
  const start = Date.now();
  try {
    const outcome = await fn();
    const stage = {
      name,
      duration_ms: Date.now() - start,
      status: "ok" as const,
      counts: outcome?.counts || {},
      ...(outcome?.detail ? { detail: outcome.detail } : {}),
    };
    results.push(stage);
    return { counts: stage.counts, detail: stage.detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      duration_ms: Date.now() - start,
      status: "error",
      counts: {},
      error: message.substring(0, 500),
    });
    throw error;
  }
}

function matchesEntityBoundary(text: string, form: string): boolean {
  const escaped = form.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text.toLowerCase());
}

function validateEntityCandidateInChunk(candidate: CandidateDecision, analysisText: string): boolean {
  const forms = new Set([
    candidate.rawCandidate,
    candidate.normalizedCandidate,
    candidate.name,
  ].map((value) => value.toLowerCase()).filter(Boolean));
  for (const form of forms) {
    if (matchesEntityBoundary(analysisText, form)) return true;
  }
  return false;
}

function candidateBoundaryMatch(text: string, value: string): boolean {
  const escaped = value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text.toLowerCase());
}

function attributeEpisodeCandidateToChunk(
  candidate: ReturnType<typeof extractTopicCandidates>[number],
  chunkArtifact: { id: number; normalizedText: string },
): CandidateDecision | null {
  const forms = new Set<string>([
    candidate.normalizedCandidate,
    candidate.rawCandidate,
    candidate.name,
  ].map((value) => value.toLowerCase()).filter(Boolean));

  const matchedForm = [...forms].find((form) => candidateBoundaryMatch(chunkArtifact.normalizedText, form));
  if (!matchedForm) return null;

  return {
    ...candidate,
    chunkId: chunkArtifact.id,
    decision: "accepted",
    decisionReason: "candidate_survived_filters",
    provenance: [...candidate.provenance, "episode_generated", `chunk_boundary_match:${matchedForm}`],
  };
}

function rankEpisodeCandidate(candidate: ReturnType<typeof extractTopicCandidates>[number]): number {
  let rank = 0;
  if (candidate.kind === "entity") rank += 1_000_000;
  if (candidate.kind === "phrase") rank += 750_000;
  if (candidate.source === "phrase_lexicon") rank += 500_000;
  if (candidate.source === "episode_phrase_heuristic") rank += 450_000;
  if (candidate.normalizedCandidate.includes(" ")) rank += 200_000;
  if (candidate.normalizedCandidate === "llms") rank += 150_000;
  rank += candidate.score;
  return rank;
}

function buildEpisodeHybridCandidateDecisions(
  analyzedChunks: Array<{
    id: number;
    episode_id: number;
    textArtifact: ReturnType<typeof normalizeChunkText>;
  }>,
  phraseLexicon: ReturnType<typeof buildPhraseLexicon>,
): CandidateDecision[] {
  const byEpisode = new Map<number, typeof analyzedChunks>();
  for (const chunk of analyzedChunks) {
    const group = byEpisode.get(chunk.episode_id) || [];
    group.push(chunk);
    byEpisode.set(chunk.episode_id, group);
  }

  const decisions: CandidateDecision[] = [];

  for (const chunk of analyzedChunks) {
    const chunkEntityCandidates = extractTopicCandidates(chunk.textArtifact, chunk.id, 5, phraseLexicon, "yaket_bobbin")
      .filter((candidate) => candidate.kind === "entity");
    decisions.push(...decideCandidateDecisions(chunkEntityCandidates, 5));
  }

  for (const [, episodeChunks] of byEpisode) {
    const episodeText = episodeChunks.map((chunk) => chunk.textArtifact.normalizedText).join(" ");
    const episodeArtifact = normalizeChunkText(episodeText);
    const rawCandidates = [
      ...extractTopicCandidates(episodeArtifact, 0, 5, phraseLexicon, "yaket_bobbin"),
      ...extractHeuristicPhraseCandidates(episodeArtifact, 0, 8),
    ]
      .filter((candidate) => {
        if (candidate.kind === "entity") return true;
        if (candidate.source === "phrase_lexicon" || candidate.source === "episode_phrase_heuristic") return true;
        if (candidate.normalizedCandidate.includes(" ")) return true;
        return candidate.normalizedCandidate === "llms";
      })
      .sort((left, right) => rankEpisodeCandidate(right) - rankEpisodeCandidate(left));

    const dedupedCandidates = new Map<string, typeof rawCandidates[number]>();
    for (const candidate of rawCandidates) {
      if (!dedupedCandidates.has(candidate.slug)) {
        dedupedCandidates.set(candidate.slug, candidate);
      }
    }
    const selectedCandidates = [...dedupedCandidates.values()].slice(0, 14);

    const attributedByChunk = new Map<number, typeof rawCandidates>();
    for (const candidate of selectedCandidates) {
      for (const chunk of episodeChunks) {
        const attributed = attributeEpisodeCandidateToChunk(candidate, {
          id: chunk.id,
          normalizedText: chunk.textArtifact.normalizedText,
        });
        if (!attributed) continue;
        const group = attributedByChunk.get(chunk.id) || [];
        group.push(attributed);
        attributedByChunk.set(chunk.id, group);
      }
    }

    for (const [chunkId, chunkCandidates] of attributedByChunk) {
      void chunkId;
      decisions.push(...decideCandidateDecisions(chunkCandidates, 5));
    }
  }

  return decisions;
}

function collectFormattingHints(blocks: import("../types").RichBlock[]): string[] {
  const hints = new Set<string>();
  for (const block of blocks) {
    if (block.depth > 0) hints.add("nested_list");
    for (const node of block.nodes) {
      if (node.bold) hints.add("bold");
      if (node.italic) hints.add("italic");
      if (node.underline) hints.add("underline");
      if (node.superscript) hints.add("superscript");
      if (node.strikethrough) hints.add("strikethrough");
      if (node.type === "image") hints.add("image");
    }
  }
  return [...hints];
}

async function loadCandidatePromotionStats(
  db: D1Database,
  candidates: CandidateDecision[]
): Promise<Map<string, { chunkSupport: number; episodeSupport: number; existingUsageCount: number; wordDistinctiveness: number; llmSupportCount: number; fidelitySupportCount: number }>> {
  const accepted = candidates.filter((candidate) => candidate.decision === "accepted");
  if (accepted.length === 0) return new Map();

  const slugs = [...new Set(accepted.map((candidate) => candidate.slug))];
  const BATCH = 40;
  const supportRows: Array<{ slug: string; chunk_id: number; episode_id: number }> = [];
  const topicRows: Array<{ slug: string; usage_count: number }> = [];
  for (let i = 0; i < slugs.length; i += BATCH) {
    const batch = slugs.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const supportBatch = await db.prepare(
      `SELECT a.slug, a.chunk_id, c.episode_id
       FROM topic_candidate_audit a
       JOIN chunks c ON c.id = a.chunk_id
       WHERE a.decision = 'accepted' AND a.slug IN (${placeholders})`
    ).bind(...batch).all<{ slug: string; chunk_id: number; episode_id: number }>();
    supportRows.push(...supportBatch.results);

    const topicBatch = await db.prepare(
      `SELECT slug, usage_count FROM topics WHERE slug IN (${placeholders})`
    ).bind(...batch).all<{ slug: string; usage_count: number }>();
    topicRows.push(...topicBatch.results);
  }

  const singletonWords = [...new Set(
    accepted
      .filter((candidate) => candidate.kind !== "entity" && !candidate.normalizedCandidate.includes(" "))
      .map((candidate) => candidate.normalizedCandidate)
  )];
  const distinctivenessRows: Array<{ word: string; distinctiveness: number }> = [];
  for (let i = 0; i < singletonWords.length; i += BATCH) {
    const batch = singletonWords.slice(i, i + BATCH);
    const rowBatch = await db.prepare(
      `SELECT word, distinctiveness FROM word_stats WHERE word IN (${batch.map(() => "?").join(",")})`
    ).bind(...batch).all<{ word: string; distinctiveness: number }>();
    distinctivenessRows.push(...rowBatch.results);
  }

  const supportBySlug = new Map<string, { chunkIds: Set<number>; episodeIds: Set<number> }>();
  for (const row of supportRows) {
    const current = supportBySlug.get(row.slug) || { chunkIds: new Set<number>(), episodeIds: new Set<number>() };
    current.chunkIds.add(row.chunk_id);
    current.episodeIds.add(row.episode_id);
    supportBySlug.set(row.slug, current);
  }
  const usageBySlug = new Map(topicRows.map((row) => [row.slug, row.usage_count]));
  const distinctivenessByWord = new Map(distinctivenessRows.map((row) => [row.word, row.distinctiveness]));

  const acceptedChunkIds = [...new Set(accepted.map((candidate) => candidate.chunkId))];
  const chunkRows: Array<{ id: number; episode_id: number; links_json: string | null; rich_content_json: string | null; images_json: string | null }> = [];
  for (let i = 0; i < acceptedChunkIds.length; i += BATCH) {
    const batch = acceptedChunkIds.slice(i, i + BATCH);
    const rowBatch = await db.prepare(
      `SELECT id, episode_id, links_json, rich_content_json, images_json FROM chunks WHERE id IN (${batch.map(() => "?").join(",")})`
    ).bind(...batch).all<{ id: number; episode_id: number; links_json: string | null; rich_content_json: string | null; images_json: string | null }>();
    chunkRows.push(...rowBatch.results);
  }
  const episodeByChunkId = new Map(chunkRows.map((row) => [row.id, row.episode_id]));
  const fidelityByChunkId = new Map(chunkRows.map((row) => [
    row.id,
    !!(row.links_json && row.links_json !== "[]") ||
      !!(row.images_json && row.images_json !== "[]") ||
      !!(row.rich_content_json && (/"depth":[1-9]/.test(row.rich_content_json) || /"(bold|italic|underline|superscript|strikethrough)":true/.test(row.rich_content_json))),
  ]));

  const currentSupportBySlug = new Map<string, { chunkIds: Set<number>; episodeIds: Set<number> }>();
  for (const candidate of accepted) {
    const current = currentSupportBySlug.get(candidate.slug) || { chunkIds: new Set<number>(), episodeIds: new Set<number>() };
    current.chunkIds.add(candidate.chunkId);
    const episodeId = episodeByChunkId.get(candidate.chunkId);
    if (episodeId) current.episodeIds.add(episodeId);
    currentSupportBySlug.set(candidate.slug, current);
  }

  const llmBoostsByChunk = await loadLlmBoostsForChunks(db, acceptedChunkIds);
  const llmSupportBySlug = new Map<string, number>();
  const fidelitySupportBySlug = new Map<string, number>();
  for (const candidate of accepted) {
    const chunkBoosts = llmBoostsByChunk.get(candidate.chunkId);
    if (!chunkBoosts?.has(candidate.slug)) continue;
    llmSupportBySlug.set(candidate.slug, (llmSupportBySlug.get(candidate.slug) || 0) + 1);
  }
  for (const candidate of accepted) {
    if (!fidelityByChunkId.get(candidate.chunkId)) continue;
    fidelitySupportBySlug.set(candidate.slug, (fidelitySupportBySlug.get(candidate.slug) || 0) + 1);
  }

  return new Map(slugs.map((slug) => {
    const candidate = accepted.find((item) => item.slug === slug)!;
    const support = supportBySlug.get(slug) || { chunkIds: new Set<number>(), episodeIds: new Set<number>() };
    const current = currentSupportBySlug.get(slug) || { chunkIds: new Set<number>(), episodeIds: new Set<number>() };
    const allChunkIds = new Set([...support.chunkIds, ...current.chunkIds]);
    const allEpisodeIds = new Set([...support.episodeIds, ...current.episodeIds]);
    return [slug, {
      chunkSupport: allChunkIds.size,
      episodeSupport: allEpisodeIds.size,
      existingUsageCount: usageBySlug.get(slug) || 0,
      wordDistinctiveness: distinctivenessByWord.get(candidate.normalizedCandidate) || 0,
      llmSupportCount: llmSupportBySlug.get(slug) || 0,
      fidelitySupportCount: fidelitySupportBySlug.get(slug) || 0,
    }];
  }));
}

/**
 * Phase 1: Fast insert — episodes and chunks only.
 * No topics, no word stats, no embeddings. Designed for the cron path.
 */
export async function ingestEpisodesOnly(
  db: D1Database,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<{ episodesAdded: number; chunksAdded: number; insertedEpisodes: InsertedEpisodeArtifact[] }> {
  let episodesAdded = 0;
  let chunksAdded = 0;
  const insertedEpisodes: InsertedEpisodeArtifact[] = [];

  const existingDates = await getExistingDatesForSource(db, sourceId);
  const sourceTag = await getSourceTag(db, sourceId);
  const storedEpisodes = buildStoredEpisodes(
    episodes,
    (episode) => `${formatDate(episode.parsedDate)}-${sourceTag}`,
    (_episode, episodeSlug, chunk) => `${slugify(chunk.title) || `chunk-${chunk.position}`}-${episodeSlug}-${chunk.position}`,
  );

  for (const episode of storedEpisodes) {
    const dateStr = formatDate(episode.parsedDate);
    if (existingDates.has(dateStr)) continue;

    const episodeSlug = episode.slug;
    const storedChunks = episode.storedChunks;
    const episodeRichContent = episode.richContent;
    const episodeResult = await db.prepare(
      `INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format, content_markdown, rich_content_json, links_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sourceId, episodeSlug, episode.title, dateStr,
        episode.parsedDate.getUTCFullYear(),
        episode.parsedDate.getUTCMonth() + 1,
        episode.parsedDate.getUTCDate(),
        storedChunks.length, episode.format,
        null,
        null,
        null,
      )
      .run();

    const episodeId = episodeResult.meta.last_row_id;
    episodesAdded++;

    const chunkInserts: D1PreparedStatement[] = [];
    for (const chunk of storedChunks) {
      const wordCount = countWords(chunk.contentPlain);
      const vectorId = `chunk-${episodeSlug}-${chunk.position}`;

      chunkInserts.push(
        db.prepare(
          `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, word_count, vector_id, content_markdown, rich_content_json, links_json, images_json, footnotes_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          episodeId,
          chunk.slug,
          chunk.title,
          chunk.content,
          chunk.contentPlain,
          chunk.position,
          wordCount,
          vectorId,
          chunk.contentMarkdown,
          JSON.stringify(chunk.richContent),
          JSON.stringify(chunk.links),
          JSON.stringify(chunk.images),
          JSON.stringify(chunk.footnotes),
        )
      );
    }

    await batchExec(db, chunkInserts);
    await persistEpisodeArtifactChunks(db, Number(episodeId), {
      content_markdown: episode.contentMarkdown,
      rich_content_json: JSON.stringify(episodeRichContent),
      links_json: JSON.stringify(episode.links),
    });
    const insertedChunkRows = await db.prepare(
      "SELECT id, slug, title, content_plain FROM chunks WHERE episode_id = ? ORDER BY position"
    ).bind(episodeId).all<{ id: number; slug: string; title: string; content_plain: string }>();
    insertedEpisodes.push({
      id: Number(episodeId),
      slug: episodeSlug,
      title: episode.title,
      chunks: insertedChunkRows.results.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        contentPlain: row.content_plain,
        linkCount: storedChunks.find((chunk) => chunk.slug === row.slug)?.links.length || 0,
        imageCount: storedChunks.find((chunk) => chunk.slug === row.slug)?.images.length || 0,
        maxDepth: Math.max(0, ...(storedChunks.find((chunk) => chunk.slug === row.slug)?.richContent.map((block) => block.depth) || [0])),
        formattingHints: collectFormattingHints(storedChunks.find((chunk) => chunk.slug === row.slug)?.richContent || []),
      })),
    });
    chunksAdded += storedChunks.length;
  }

  return { episodesAdded, chunksAdded, insertedEpisodes };
}

export async function backfillExistingEpisodes(
  db: D1Database,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<{ episodesUpdated: number; chunksUpdated: number; backfilledEpisodes: BackfilledEpisodeArtifact[] }> {
  let episodesUpdated = 0;
  let chunksUpdated = 0;
  const backfilledEpisodes: BackfilledEpisodeArtifact[] = [];

  const existing = await db.prepare(
    "SELECT id, slug, title, published_date FROM episodes WHERE source_id = ? ORDER BY published_date ASC"
  ).bind(sourceId).all<{ id: number; slug: string; title: string; published_date: string }>();
  const byDate = new Map(existing.results.map((row) => [row.published_date, row]));
  const existingEpisodeIds = existing.results.map((row) => row.id);
  const existingChunkRowsByEpisodeId = new Map<number, Array<{ id: number; slug: string; position: number }>>();
  const BATCH = 90;
  for (let i = 0; i < existingEpisodeIds.length; i += BATCH) {
    const batch = existingEpisodeIds.slice(i, i + BATCH);
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => "?").join(",");
    const chunkRows = await db.prepare(
      `SELECT id, episode_id, slug, position FROM chunks WHERE episode_id IN (${placeholders}) ORDER BY episode_id, position`
    ).bind(...batch).all<{ id: number; episode_id: number; slug: string; position: number }>();
    for (const row of chunkRows.results) {
      const current = existingChunkRowsByEpisodeId.get(row.episode_id) || [];
      current.push({ id: row.id, slug: row.slug, position: row.position });
      existingChunkRowsByEpisodeId.set(row.episode_id, current);
    }
  }

  const storedEpisodes = buildStoredEpisodes(
    episodes.filter((episode) => byDate.has(formatDate(episode.parsedDate))),
    (episode) => byDate.get(formatDate(episode.parsedDate))!.slug,
    (episode, episodeSlug, chunk) => {
      const existingEpisode = byDate.get(formatDate(episode.parsedDate));
      const existingChunk = existingEpisode
        ? (existingChunkRowsByEpisodeId.get(existingEpisode.id) || []).find((row) => row.position === chunk.position)
        : null;
      return existingChunk?.slug || `${slugify(chunk.title) || `chunk-${chunk.position}`}-${episodeSlug}-${chunk.position}`;
    },
  );

  for (const episode of storedEpisodes) {
    const dateStr = formatDate(episode.parsedDate);
    const existingEpisode = byDate.get(dateStr);
    if (!existingEpisode) continue;

    const storedChunks = episode.storedChunks;
    const episodeRichContent = episode.richContent;

    await db.prepare(
      `UPDATE episodes
       SET title = ?, chunk_count = ?, format = ?, content_markdown = ?, rich_content_json = ?, links_json = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      episode.title,
      storedChunks.length,
      episode.format,
      null,
      null,
      null,
      existingEpisode.id,
    ).run();
    await persistEpisodeArtifactChunks(db, existingEpisode.id, {
      content_markdown: episode.contentMarkdown,
      rich_content_json: JSON.stringify(episodeRichContent),
      links_json: JSON.stringify(episode.links),
    });

    const chunkRows = existingChunkRowsByEpisodeId.get(existingEpisode.id) || [];
    const chunkByPosition = new Map(chunkRows.map((row) => [row.position, row]));
    const parsedChunkByPosition = new Map(storedChunks.map((chunk) => [chunk.position, chunk]));
    const updatedChunks: number[] = [];

    for (const chunk of storedChunks) {
      const existingChunk = chunkByPosition.get(chunk.position);
      const wordCount = countWords(chunk.contentPlain);
      if (existingChunk) {
        await db.prepare(
          `UPDATE chunks
           SET title = ?, content = ?, content_plain = ?, word_count = ?, content_markdown = ?, rich_content_json = ?, links_json = ?, images_json = ?, footnotes_json = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).bind(
          chunk.title,
          chunk.content,
          chunk.contentPlain,
          wordCount,
          chunk.contentMarkdown,
          JSON.stringify(chunk.richContent.map((block) => ({ ...block, chunkSlug: existingChunk.slug }))),
          JSON.stringify(chunk.links),
          JSON.stringify(chunk.images),
          JSON.stringify(chunk.footnotes),
          existingChunk.id,
        ).run();
        updatedChunks.push(existingChunk.id);
        chunksUpdated++;
      }
    }

    const BATCH = 90;
    for (let i = 0; i < updatedChunks.length; i += BATCH) {
      const batch = updatedChunks.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      await db.prepare(
        `UPDATE chunks
         SET enriched = 0, enrichment_version = 0
         WHERE id IN (${placeholders})`
      ).bind(...batch).run();
    }

    backfilledEpisodes.push({
      id: existingEpisode.id,
      slug: existingEpisode.slug,
      title: episode.title,
       chunks: chunkRows
         .filter((row) => updatedChunks.includes(row.id))
         .map((row) => {
           const parsedChunk = parsedChunkByPosition.get(row.position);
           return {
            id: row.id,
            slug: row.slug,
            title: parsedChunk?.title || row.slug,
            contentPlain: parsedChunk?.contentPlain || "",
            linkCount: parsedChunk?.links.length || 0,
            imageCount: parsedChunk?.images.length || 0,
            maxDepth: Math.max(0, ...(parsedChunk?.richContent.map((block) => block.depth) || [0])),
            formattingHints: collectFormattingHints(parsedChunk?.richContent || []),
          };
        }),
      updatedChunks,
    });
    episodesUpdated++;
  }

  return { episodesUpdated, chunksUpdated, backfilledEpisodes };
}

/**
 * Shared core: process a batch of chunks — extract topics, insert to DB.
 * Used by both enrichChunks (API path) and handleEnrichBatch (queue path).
 * Single source of truth for topic extraction logic.
 */
export async function processChunkBatch(
  db: D1Database,
  seedChunks: { id: number; episode_id: number; content_plain: string }[],
  extractorMode: TopicExtractorMode = "naive"
): Promise<ProcessChunkBatchResult> {
  if (!seedChunks.length) {
    return {
      extractorMode,
      chunksProcessed: 0,
      candidatesGenerated: 0,
      candidatesRejectedEarly: 0,
      candidatesInserted: 0,
      topicsInserted: 0,
      chunkTopicLinksInserted: 0,
      chunkWordRowsInserted: 0,
      stageResults: [],
      auditReport: [],
    };
  }

  let chunks = seedChunks;
  if (extractorMode === "episode_hybrid") {
    const episodeIds = [...new Set(seedChunks.map((chunk) => chunk.episode_id))];
    const BATCH = 90;
    const episodeChunks: Array<{ id: number; episode_id: number; content_plain: string }> = [];
    for (let i = 0; i < episodeIds.length; i += BATCH) {
      const batch = episodeIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await db.prepare(
        `SELECT id, episode_id, content_plain FROM chunks WHERE episode_id IN (${placeholders})`
      ).bind(...batch).all<{ id: number; episode_id: number; content_plain: string }>();
      episodeChunks.push(...rows.results);
    }
    chunks = episodeChunks;
  }

  const stageResults: PipelineStageResult[] = [];
  const chunkIds = chunks.map((chunk) => chunk.id);
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const BATCH_DEL = 90;
  let analyzedChunks: Array<{
    id: number;
    episode_id: number;
    content_plain: string;
    textArtifact: ReturnType<typeof normalizeChunkText>;
    tokens: string[];
    wordCounts: Map<string, number>;
  }> = [];
  let phraseLexicon = [] as ReturnType<typeof buildPhraseLexicon>;
  let candidateDecisions: CandidateDecision[] = [];
  let promotableCandidates: CandidateDecision[] = [];
  let uniqueTopics = new Map<string, { name: string; kind: string }>();
  let chunkTopicPairs: { chunkId: number; episodeId: number; topicSlug: string }[] = [];
  let wordRowCount = 0;

  await runPipelineStage("normalize_chunks", stageResults, async () => {
    analyzedChunks = chunks.map((chunk) => {
      const textArtifact = normalizeChunkText(chunk.content_plain);
      const tokens = tokenizeNormalizedText(textArtifact.normalizedText);
      const wordCounts = countTokenFrequencies(tokens);
      return { ...chunk, textArtifact, tokens, wordCounts };
    });

    const artifactUpdates = analyzedChunks.map((chunk) =>
      db.prepare(
        `UPDATE chunks
         SET analysis_text = ?, normalization_version = ?, normalization_warnings = ?
         WHERE id = ?`
      ).bind(
        chunk.textArtifact.normalizedText,
        CURRENT_NORMALIZATION_VERSION,
        JSON.stringify(chunk.textArtifact.warnings),
        chunk.id
      )
    );
    await batchExec(db, artifactUpdates);
    return {
      counts: {
        chunks_processed: analyzedChunks.length,
        warnings_emitted: analyzedChunks.reduce((sum, chunk) => sum + chunk.textArtifact.warnings.length, 0),
        rows_written: artifactUpdates.length,
      },
    };
  });

  await runPipelineStage("clear_chunk_local_artifacts", stageResults, async () => {
    let deletedRows = 0;
    for (const table of ["topic_candidate_audit", "chunk_words", "chunk_topics"]) {
      for (let i = 0; i < chunkIds.length; i += BATCH_DEL) {
        const batch = chunkIds.slice(i, i + BATCH_DEL);
        const ph = batch.map(() => "?").join(",");
        const result = await db.prepare(`DELETE FROM ${table} WHERE chunk_id IN (${ph})`).bind(...batch).run();
        deletedRows += result.meta.changes || 0;
      }
    }
    return { counts: { rows_deleted: deletedRows } };
  });

  await runPipelineStage("tokenize_chunks", stageResults, async () => ({
    counts: {
      chunks_tokenized: analyzedChunks.length,
      tokens_emitted: analyzedChunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0),
      distinct_words: analyzedChunks.reduce((sum, chunk) => sum + chunk.wordCounts.size, 0),
    },
  }));

  await runPipelineStage("phrase_discovery", stageResults, async () => {
    const normalizedCorpus = await db.prepare(
      `SELECT id, analysis_text
       FROM chunks
       WHERE normalization_version > 0 AND analysis_text IS NOT NULL AND analysis_text != ''`
    ).all<{ id: number; analysis_text: string }>();
    const corpusDocuments = normalizedCorpus.results.map((row) => ({
      chunkId: row.id,
      normalizedText: row.analysis_text,
      tokens: tokenizeNormalizedText(row.analysis_text),
    }));
    phraseLexicon = buildPhraseLexicon(corpusDocuments);

    await db.prepare("DELETE FROM phrase_lexicon").run();
    const phraseLexiconInserts = phraseLexicon.map((entry) =>
      db.prepare(
        `INSERT INTO phrase_lexicon (phrase, slug, support_count, doc_count, quality_score, provenance)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(entry.phrase, entry.slug, entry.supportCount, entry.docCount, entry.qualityScore, entry.provenance)
    );
    await batchExec(db, phraseLexiconInserts);
    return {
      counts: {
        lexicon_entries: phraseLexicon.length,
        rows_written: phraseLexiconInserts.length,
      },
    };
  });

  await runPipelineStage("candidate_extraction", stageResults, async () => {
    candidateDecisions = extractorMode === "episode_hybrid"
      ? buildEpisodeHybridCandidateDecisions(analyzedChunks, phraseLexicon)
      : analyzedChunks.flatMap((chunk) =>
          extractCandidateDecisions(chunk.textArtifact, chunk.id, 5, phraseLexicon, extractorMode)
        );

    return {
      counts: {
        candidates_generated: candidateDecisions.length,
        candidates_initially_rejected: candidateDecisions.filter((row) => row.decision === "rejected").length,
      },
    };
  });

  await runPipelineStage("early_entity_validation", stageResults, async () => {
    let rejected = 0;
    const artifactByChunkId = new Map(analyzedChunks.map((chunk) => [chunk.id, chunk.textArtifact.normalizedText]));
    for (const candidate of candidateDecisions) {
      if (candidate.decision !== "accepted" || candidate.kind !== "entity") continue;
      const analysisText = artifactByChunkId.get(candidate.chunkId) || "";
      if (validateEntityCandidateInChunk(candidate, analysisText)) continue;
      candidate.decision = "rejected";
      candidate.decisionReason = "entity_boundary_mismatch";
      rejected++;
    }

    return { counts: { entity_candidates_rejected: rejected } };
  });

  await runPipelineStage("corpus_prior_rejection", stageResults, async () => {
    const promotionStats = await loadCandidatePromotionStats(db, candidateDecisions);
    let rejected = 0;
    for (const candidate of candidateDecisions) {
      if (candidate.decision !== "accepted") continue;
      const stats = promotionStats.get(candidate.slug);
      if (!stats) continue;
      const rejectionReason = getCorpusPriorRejectionReason(candidate, stats);
      if (!rejectionReason) continue;
      candidate.decision = "rejected";
      candidate.decisionReason = rejectionReason;
      rejected++;
    }

    return { counts: { corpus_prior_rejected: rejected } };
  });

  const candidateAuditInserts = candidateDecisions.map((candidate) =>
    db.prepare(
      `INSERT INTO topic_candidate_audit (
         chunk_id, source, stage, raw_candidate, normalized_candidate,
         topic_name, slug, score, kind, decision, decision_reason, provenance
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      candidate.chunkId,
      candidate.source,
      candidate.decision === "accepted" ? "candidate_extraction" : "candidate_rejection",
      candidate.rawCandidate,
      candidate.normalizedCandidate,
      candidate.name,
      candidate.slug,
      candidate.score,
      candidate.kind,
      candidate.decision,
      candidate.decisionReason,
      JSON.stringify(candidate.provenance)
    )
  );
  await batchExec(db, candidateAuditInserts);

  await runPipelineStage("promotion_gating", stageResults, async () => {
    const promotionStats = await loadCandidatePromotionStats(db, candidateDecisions);
    promotableCandidates = candidateDecisions.filter((candidate) => {
      if (candidate.decision !== "accepted") return false;
      const stats = promotionStats.get(candidate.slug);
      if (!stats) return false;
      const reason = getCandidatePromotionReason(candidate, stats);
      if (!reason) return true;
      candidate.decisionReason = reason;
      return false;
    });

    const promotableSlugs = new Set(promotableCandidates.map((candidate) => candidate.slug));
    const currentChunkIds = [...new Set(candidateDecisions.map((candidate) => candidate.chunkId))];
    if (currentChunkIds.length > 0) {
      const BATCH = 40;
      for (let i = 0; i < currentChunkIds.length; i += BATCH) {
        const chunkBatch = currentChunkIds.slice(i, i + BATCH);
        const chunkPlaceholders = chunkBatch.map(() => "?").join(",");
        await db.prepare(
          `UPDATE topic_candidate_audit
           SET stage = 'promotion_deferred'
           WHERE decision = 'accepted' AND chunk_id IN (${chunkPlaceholders})`
        ).bind(...chunkBatch).run();
      }

      const promotableSlugList = [...promotableSlugs];
      for (let i = 0; i < currentChunkIds.length; i += BATCH) {
        const chunkBatch = currentChunkIds.slice(i, i + BATCH);
        const chunkPlaceholders = chunkBatch.map(() => "?").join(",");
        for (let j = 0; j < promotableSlugList.length; j += BATCH) {
          const slugBatch = promotableSlugList.slice(j, j + BATCH);
          const placeholders = slugBatch.map(() => "?").join(",");
          await db.prepare(
            `UPDATE topic_candidate_audit
             SET stage = 'promotion_ready'
             WHERE decision = 'accepted' AND chunk_id IN (${chunkPlaceholders}) AND slug IN (${placeholders})`
          ).bind(...chunkBatch, ...slugBatch).run();
        }
      }
    }

    uniqueTopics = new Map<string, { name: string; kind: string }>();
    for (const candidate of promotableCandidates) {
      const existing = uniqueTopics.get(candidate.slug);
      if (!existing || candidate.kind === "entity" || existing.kind !== "entity") {
        uniqueTopics.set(candidate.slug, { name: candidate.name, kind: candidate.kind });
      }
    }

    return {
      counts: {
        candidates_generated: candidateDecisions.length,
        candidates_rejected_early: candidateDecisions.filter((row) => row.decision === "rejected").length,
        candidates_insertable: promotableCandidates.length,
        candidates_deferred: candidateDecisions.filter((row) => row.decision === "accepted").length - promotableCandidates.length,
        rows_written: candidateAuditInserts.length,
      },
    };
  });

  await runPipelineStage("topic_insertion", stageResults, async () => {
    const topicInserts = [...uniqueTopics.entries()].map(([slug, { name, kind }]) =>
      db.prepare("INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, ?)").bind(name, slug, kind)
    );
    await batchExec(db, topicInserts);

    const topicUpdates: D1PreparedStatement[] = [];
    for (const [slug, topic] of uniqueTopics.entries()) {
      if (topic.kind === "entity") {
        topicUpdates.push(
          db.prepare("UPDATE topics SET name = ?, kind = 'entity' WHERE slug = ?").bind(topic.name, slug)
        );
      } else if (topic.kind === "phrase") {
        topicUpdates.push(
          db.prepare("UPDATE topics SET kind = 'phrase' WHERE slug = ? AND kind != 'entity'").bind(slug)
        );
      }
    }
    await batchExec(db, topicUpdates);

    if (uniqueTopics.size === 0) {
      return {
        counts: {
          topics_inserted_or_touched: 0,
          provenance_linked: 0,
        },
      };
    }

    const provenanceUpdates = promotableCandidates
      .map((candidate) =>
        db.prepare(
          `UPDATE topic_candidate_audit
           SET topic_id = (SELECT id FROM topics WHERE slug = ?), stage = 'topic_promoted'
           WHERE slug = ? AND decision = 'accepted'`
        ).bind(candidate.slug, candidate.slug)
      );
    await batchExec(db, provenanceUpdates);

    await db.prepare(
      `UPDATE topics
       SET provenance_complete = CASE
         WHEN EXISTS (SELECT 1 FROM topic_candidate_audit WHERE topic_id = topics.id AND decision = 'accepted') THEN 1
         ELSE 0
       END
       WHERE slug IN (SELECT DISTINCT slug FROM topic_candidate_audit WHERE decision = 'accepted')`
    ).run();

    return {
      counts: {
        topics_inserted_or_touched: uniqueTopics.size,
        provenance_linked: provenanceUpdates.length,
      },
    };
  });

  await runPipelineStage("chunk_topic_insertion", stageResults, async () => {
    let episodeIds = [...new Set(chunks.map((chunk) => chunk.episode_id))];
    let filteredInvalidEntityLinks = 0;

    if (uniqueTopics.size > 0) {
      const slugs = [...uniqueTopics.keys()];
      const placeholders = slugs.map(() => "?").join(",");
      const promotedRows: Array<{ chunk_id: number; episode_id: number; slug: string; kind: string; name: string; analysis_text: string }> = [];
      const BATCH = 40;
      for (let i = 0; i < slugs.length; i += BATCH) {
        const slugBatch = slugs.slice(i, i + BATCH);
        const placeholders = slugBatch.map(() => "?").join(",");
        const rowBatch = await db.prepare(
          `SELECT DISTINCT a.chunk_id, c.episode_id, a.slug, t.kind, t.name, COALESCE(c.analysis_text, c.content_plain) AS analysis_text
           FROM topic_candidate_audit a
           JOIN chunks c ON c.id = a.chunk_id
           JOIN topics t ON t.slug = a.slug
           WHERE a.decision = 'accepted' AND a.slug IN (${placeholders})`
        ).bind(...slugBatch).all<{ chunk_id: number; episode_id: number; slug: string; kind: string; name: string; analysis_text: string }>();
        promotedRows.push(...rowBatch.results);
      }

      filteredInvalidEntityLinks = promotedRows.filter((row) => row.kind === "entity" && !matchesEntityBoundary(row.analysis_text, row.name)).length;
      chunkTopicPairs = promotedRows
        .filter((row) => row.kind !== "entity" || matchesEntityBoundary(row.analysis_text, row.name))
        .map((row) => ({ chunkId: row.chunk_id, episodeId: row.episode_id, topicSlug: row.slug }));
    } else {
      chunkTopicPairs = [];
    }

    episodeIds = [...new Set(chunkTopicPairs.map((pair) => pair.episodeId).concat(episodeIds))];
    for (const epId of episodeIds) {
      await db.prepare("DELETE FROM episode_topics WHERE episode_id = ?").bind(epId).run();
    }

    const ctStmts: D1PreparedStatement[] = [];
    for (const { chunkId, topicSlug } of chunkTopicPairs) {
      ctStmts.push(
        db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) SELECT ?, id FROM topics WHERE slug = ?")
          .bind(chunkId, topicSlug)
      );
    }
    await batchExec(db, ctStmts);

    const etStmts = episodeIds.flatMap((epId) =>
      chunks
        .filter((chunk) => chunk.episode_id === epId)
        .map((chunk) =>
          db.prepare(
            "INSERT OR IGNORE INTO episode_topics (episode_id, topic_id) SELECT ?, topic_id FROM chunk_topics WHERE chunk_id = ?"
          ).bind(epId, chunk.id)
        )
    );
    await batchExec(db, etStmts);

    return {
      counts: {
        chunk_topic_links_inserted: ctStmts.length,
        episode_topic_links_inserted: etStmts.length,
        invalid_entity_links_filtered: filteredInvalidEntityLinks,
      },
      detail: `prepared ${chunkTopicPairs.length} promotable chunk-topic links`,
    };
  });

  await runPipelineStage("word_stats_rebuild", stageResults, async () => {
    const wordStmts: D1PreparedStatement[] = [];
    wordRowCount = 0;
    for (const chunk of analyzedChunks) {
      for (const [word, count] of chunk.wordCounts) {
        wordStmts.push(
          db.prepare("INSERT OR REPLACE INTO chunk_words (chunk_id, word, count) VALUES (?, ?, ?)")
            .bind(chunk.id, word, count)
        );
        wordRowCount++;
      }
    }
    await batchExec(db, wordStmts);
    await rebuildWordStatsAggregates(db);
    return {
      counts: {
        chunk_word_rows_written: wordRowCount,
      },
    };
  });

  await runPipelineStage("mark_chunks_enriched", stageResults, async () => {
    await markChunksEnriched(db, chunkIds);
    return { counts: { chunks_marked_enriched: chunkIds.length } };
  });

  return {
    extractorMode,
    chunksProcessed: chunks.length,
    candidatesGenerated: candidateDecisions.length,
    candidatesRejectedEarly: candidateDecisions.filter((row) => row.decision === "rejected").length,
    candidatesInserted: promotableCandidates.length,
    topicsInserted: uniqueTopics.size,
    chunkTopicLinksInserted: chunkTopicPairs.length,
    chunkWordRowsInserted: wordRowCount,
    stageResults,
    auditReport: candidateDecisions.slice(0, 10).map((candidate) => ({
      chunk_id: candidate.chunkId,
      source: candidate.source,
      raw_candidate: candidate.rawCandidate,
      normalized_candidate: candidate.normalizedCandidate,
      decision: candidate.decision,
      decision_reason: candidate.decisionReason,
    })),
  };
}

/**
 * Phase 2: Enrich a batch of chunks that don't have topics yet.
 * Adds topics, chunk_topics, episode_topics, chunk_words, and rebuilds word_stats.
 * Call repeatedly until isEnrichmentComplete() returns true.
 */
export async function enrichChunks(
  db: D1Database,
  batchSize: number = 200,
  extractorMode: TopicExtractorMode = "naive"
): Promise<{ chunksProcessed: number; batch?: ProcessChunkBatchResult }> {
  const chunks = await getUnenrichedChunks(db, batchSize);
  if (!chunks.length) return { chunksProcessed: 0 };

  const batch = await processChunkBatch(db, chunks, extractorMode);

  return { chunksProcessed: chunks.length, batch };
}

/**
 * Finalize enrichment: run once after all chunks are enriched.
 * Fast steps run inline. Slow steps (related_slugs, n-gram assignment)
 * are dispatched to a queue for parallel processing when a queue is available.
 */
export interface FinalizeStep {
  name: string;
  duration_ms: number;
  status: "ok" | "error";
  counts: Record<string, number>;
  error?: string;
  detail?: string;
}

export interface FinalizeResult {
  usage_recalculated: boolean;
  word_stats_rebuilt: boolean;
  ngram_dispatched: boolean;
  related_slugs_method: "batch_sql" | "queue" | "inline" | "skipped";
  noise_removed: number;
  pruned: number;
  merged: number;
  orphan_topics_deleted: number;
  archived_lineage_topics: number;
  provenance_complete_topics: number;
  steps: FinalizeStep[];
  audit_report: PipelineAuditSample[];
  total_ms: number;
}

async function runStep(
  name: string,
  steps: FinalizeStep[],
  fn: () => Promise<{ detail?: string; counts?: Record<string, number> } | void>
): Promise<boolean> {
  const start = Date.now();
  try {
    const outcome = await fn();
    steps.push({
      name,
      duration_ms: Date.now() - start,
      status: "ok",
      counts: outcome?.counts || {},
      ...(outcome?.detail ? { detail: outcome.detail } : {}),
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({
      name,
      duration_ms: Date.now() - start,
      status: "error",
      counts: {},
      error: msg.substring(0, 500),
    });
    // Don't re-throw — continue to next step so we can see ALL failures
    return false;
  }
}

function canonicalizeExistingTopicName(name: string, kind: string): { name: string; slug: string } {
  if (kind === "entity") {
    const cleaned = normalizeChunkText(name).normalizedText
      .replace(/['\u2018\u2019\u201A]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return { name: cleaned, slug: slugify(cleaned) };
  }

  const canonical = normalizeTerm(name);
  return { name: canonical, slug: slugify(canonical) };
}

async function recountUsage(db: D1Database): Promise<number> {
  const allIds = await db.prepare("SELECT id FROM topics").all<{ id: number }>();
  const ids = allIds.results.map((row) => row.id);
  const BATCH = 90;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    await db.prepare(
      `UPDATE topics
       SET usage_count = (SELECT COUNT(*) FROM chunk_topics WHERE topic_id = topics.id)
       WHERE id IN (${placeholders})`
    ).bind(...batch).run();
  }
  return ids.length;
}

async function syncTopicDistinctiveness(db: D1Database): Promise<number> {
  const allIds = await db.prepare("SELECT id, name FROM topics").all<{ id: number; name: string }>();
  const updates = allIds.results.map((row) =>
    db.prepare(
      `UPDATE topics
       SET distinctiveness = COALESCE((SELECT w.distinctiveness FROM word_stats w WHERE w.word = LOWER(topics.name)), 0)
       WHERE id = ?`
    ).bind(row.id)
  );
  await batchExec(db, updates);
  return updates.length;
}

async function mergeTopicInto(
  db: D1Database,
  fromTopic: { id: number; slug: string },
  toTopic: { id: number; slug: string },
  stage: string,
  reason: string
): Promise<void> {
  if (fromTopic.id === toTopic.id) return;
  await db.batch([
    db.prepare("UPDATE OR IGNORE chunk_topics SET topic_id = ? WHERE topic_id = ?").bind(toTopic.id, fromTopic.id),
    db.prepare("DELETE FROM chunk_topics WHERE topic_id = ?").bind(fromTopic.id),
    db.prepare("DELETE FROM episode_topics WHERE topic_id = ?").bind(fromTopic.id),
    db.prepare("UPDATE topic_candidate_audit SET topic_id = ? WHERE topic_id = ?").bind(toTopic.id, fromTopic.id),
    db.prepare(
      `UPDATE topics
       SET usage_count = 0, hidden = 1, display_suppressed = 1, display_reason = ?
       WHERE id = ?`
    ).bind(reason, fromTopic.id),
    db.prepare(
      `INSERT INTO topic_merge_audit (from_topic_id, to_topic_id, from_slug, to_slug, stage, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(fromTopic.id, toTopic.id, fromTopic.slug, toTopic.slug, stage, reason),
  ]);
}

async function pruneTopicIds(
  db: D1Database,
  ids: number[],
  reason: string
): Promise<number> {
  if (ids.length === 0) return 0;
  const BATCH = 90;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    await db.batch([
      db.prepare(`DELETE FROM chunk_topics WHERE topic_id IN (${placeholders})`).bind(...batch),
      db.prepare(`DELETE FROM episode_topics WHERE topic_id IN (${placeholders})`).bind(...batch),
      db.prepare(
        `UPDATE topics
         SET usage_count = 0, hidden = 1, display_suppressed = 1, display_reason = ?
         WHERE id IN (${placeholders})`
      ).bind(reason, ...batch),
    ]);
  }
  return ids.length;
}

async function archiveZeroUsageLineageTopics(db: D1Database): Promise<number> {
  const lineageTopics = await db.prepare(
    `SELECT
       t.id,
       t.name,
       t.slug,
       t.kind,
       t.usage_count,
       t.distinctiveness,
       t.display_reason,
       t.provenance_complete,
       (
         SELECT m.to_topic_id FROM topic_merge_audit m
         WHERE m.from_topic_id = t.id
         ORDER BY m.id DESC LIMIT 1
       ) AS merged_to_topic_id,
       (
         SELECT m.stage FROM topic_merge_audit m
         WHERE m.from_topic_id = t.id
         ORDER BY m.id DESC LIMIT 1
       ) AS merge_stage
     FROM topics t
     WHERE t.usage_count = 0
       AND NOT EXISTS (SELECT 1 FROM chunk_topics ct WHERE ct.topic_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM episode_topics et WHERE et.topic_id = t.id)
       AND (
         EXISTS (SELECT 1 FROM topic_candidate_audit a WHERE a.topic_id = t.id)
         OR EXISTS (
           SELECT 1 FROM topic_merge_audit m
           WHERE m.from_topic_id = t.id OR m.to_topic_id = t.id
         )
       )`
  ).all<{
    id: number;
    name: string;
    slug: string;
    kind: string;
    usage_count: number;
    distinctiveness: number;
    display_reason: string | null;
    provenance_complete: number;
    merged_to_topic_id: number | null;
    merge_stage: string | null;
  }>();

  if (lineageTopics.results.length === 0) return 0;

  for (const topic of lineageTopics.results) {
    const existing = await db.prepare(
      `SELECT id, archive_count
       FROM topic_lineage_archive
       WHERE slug = ?
         AND archive_reason = 'zero_usage_lineage'
         AND COALESCE(merge_stage, '') = COALESCE(?, '')
         AND COALESCE(merged_to_topic_id, -1) = COALESCE(?, -1)
       LIMIT 1`
    ).bind(topic.slug, topic.merge_stage, topic.merged_to_topic_id).first<{ id: number; archive_count: number }>();

    if (existing) {
      await db.prepare(
        `UPDATE topic_lineage_archive
         SET archive_count = archive_count + 1,
             last_original_topic_id = ?,
             last_archived_at = datetime('now'),
             name = ?,
             kind = ?,
             usage_count = ?,
             distinctiveness = ?,
             display_reason = ?,
             provenance_complete = ?
         WHERE id = ?`
      ).bind(
        topic.id,
        topic.name,
        topic.kind,
        topic.usage_count,
        topic.distinctiveness,
        topic.display_reason,
        topic.provenance_complete,
        existing.id,
      ).run();
      continue;
    }

    await db.prepare(
      `INSERT INTO topic_lineage_archive (
         original_topic_id, name, slug, kind, usage_count, distinctiveness,
         display_reason, provenance_complete, archive_reason, merged_to_topic_id, merge_stage,
         archive_count, last_original_topic_id, last_archived_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))`
    ).bind(
      topic.id,
      topic.name,
      topic.slug,
      topic.kind,
      topic.usage_count,
      topic.distinctiveness,
      topic.display_reason,
      topic.provenance_complete,
      "zero_usage_lineage",
      topic.merged_to_topic_id,
      topic.merge_stage,
      topic.id,
    ).run();
  }

  const ids = lineageTopics.results.map((topic) => topic.id);
  const BATCH = 90;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    await db.prepare(`DELETE FROM topics WHERE id IN (${placeholders})`).bind(...batch).run();
  }

  return ids.length;
}

export async function finalizeEnrichment(db: D1Database, queue?: Queue): Promise<FinalizeResult> {
  const totalStart = Date.now();
  const steps: FinalizeStep[] = [];
  const result: FinalizeResult = {
    usage_recalculated: false,
    word_stats_rebuilt: false,
    ngram_dispatched: false,
    related_slugs_method: "skipped",
    noise_removed: 0,
    pruned: 0,
    merged: 0,
    orphan_topics_deleted: 0,
    archived_lineage_topics: 0,
    provenance_complete_topics: 0,
    steps,
    audit_report: [],
    total_ms: 0,
  };

  await runStep("phrase_lexicon_backfill", steps, async () => {
    const phrases = await db.prepare(
      "SELECT phrase, slug, support_count, doc_count, quality_score FROM phrase_lexicon ORDER BY quality_score DESC, doc_count DESC"
    ).all<{ phrase: string; slug: string; support_count: number; doc_count: number; quality_score: number }>();
    let chunkLinksInserted = 0;
    let auditRowsInserted = 0;
    let phrasesSkipped = 0;
    for (const phrase of phrases.results) {
      const rejectionReason = getPhrasePromotionReason({
        docCount: phrase.doc_count,
        supportCount: phrase.support_count,
        qualityScore: phrase.quality_score,
        normalizedName: phrase.phrase,
      });
      if (rejectionReason) {
        phrasesSkipped++;
        continue;
      }
      await db.prepare(
        "INSERT OR IGNORE INTO topics (name, slug, kind) VALUES (?, ?, 'phrase')"
      ).bind(phrase.phrase, phrase.slug).run();

      const topic = await db.prepare(
        "SELECT id FROM topics WHERE slug = ?"
      ).bind(phrase.slug).first<{ id: number }>();
      if (!topic) continue;

      const matchingChunks = await db.prepare(
        `SELECT id
         FROM chunks
         WHERE normalization_version > 0
           AND LOWER(COALESCE(analysis_text, content_plain)) LIKE ?`
      ).bind(`%${phrase.phrase}%`).all<{ id: number }>();
      const auditInsert = await db.prepare(
        `INSERT INTO topic_candidate_audit (
           chunk_id, topic_id, source, stage, raw_candidate, normalized_candidate,
           topic_name, slug, score, kind, decision, decision_reason, provenance
         )
         SELECT c.id, ?, 'phrase_lexicon', 'phrase_backfill', ?, ?, ?, ?, 0, 'phrase', 'accepted', 'phrase_backfill', ?
         FROM chunks c
         WHERE c.normalization_version > 0
           AND LOWER(COALESCE(c.analysis_text, c.content_plain)) LIKE ?
           AND NOT EXISTS (
             SELECT 1 FROM topic_candidate_audit a
             WHERE a.chunk_id = c.id AND a.slug = ? AND a.decision = 'accepted'
           )`
      ).bind(
        topic.id,
        phrase.phrase,
        phrase.phrase,
        phrase.phrase,
        phrase.slug,
        JSON.stringify(["phrase_backfill", "source:phrase_lexicon"]),
        `%${phrase.phrase}%`,
        phrase.slug
      ).run();
      auditRowsInserted += auditInsert.meta.changes || 0;
      const inserts = matchingChunks.results.map((chunk) =>
        db.prepare("INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)").bind(chunk.id, topic.id)
      );
      await batchExec(db, inserts);
      chunkLinksInserted += inserts.length;
    }

    await db.prepare("DELETE FROM episode_topics").run();
    await db.prepare(
      `INSERT OR IGNORE INTO episode_topics (episode_id, topic_id)
       SELECT DISTINCT c.episode_id, ct.topic_id
       FROM chunk_topics ct
       JOIN chunks c ON ct.chunk_id = c.id`
    ).run();

    return {
      detail: `${phrases.results.length} phrases backfilled`,
      counts: {
        phrase_topics_considered: phrases.results.length,
        phrase_topics_skipped: phrasesSkipped,
        chunk_topic_links_inserted: chunkLinksInserted,
        audit_rows_inserted: auditRowsInserted,
      },
    };
  });

  await runStep("canonicalize_topics", steps, async () => {
    const topics = await db.prepare(
      "SELECT id, name, slug, kind, usage_count FROM topics ORDER BY usage_count DESC, id ASC"
    ).all<{ id: number; name: string; slug: string; kind: string; usage_count: number }>();
    const bySlug = new Map(topics.results.map((topic) => [topic.slug, topic]));
    let renamed = 0;
    let merged = 0;
    for (const topic of topics.results) {
      const canonical = canonicalizeExistingTopicName(topic.name, topic.kind);
      if (!canonical.name || !canonical.slug) continue;
      const existing = bySlug.get(canonical.slug);
      if (existing && existing.id !== topic.id) {
        const keep = existing.usage_count >= topic.usage_count ? existing : topic;
        const dupe = keep.id === topic.id ? existing : topic;
        await mergeTopicInto(db, dupe, keep, "canonicalize_topics", "canonicalized_duplicate");
        bySlug.set(keep.slug, keep);
        merged++;
        continue;
      }
      if (canonical.name !== topic.name || canonical.slug !== topic.slug) {
        await db.prepare("UPDATE topics SET name = ?, slug = ? WHERE id = ?").bind(canonical.name, canonical.slug, topic.id).run();
        bySlug.delete(topic.slug);
        bySlug.set(canonical.slug, { ...topic, name: canonical.name, slug: canonical.slug });
        renamed++;
      }
    }
    result.merged += merged;
    return { detail: `${renamed} renamed, ${merged} merged`, counts: { renamed, merged } };
  });

  await runStep("usage_recount", steps, async () => {
    const touched = await recountUsage(db);
    result.usage_recalculated = true;
    return { detail: `${touched} topics recounted`, counts: { topics_recounted: touched } };
  });

  await runStep("word_stats_rebuild", steps, async () => {
    await rebuildWordStatsAggregates(db);
    result.word_stats_rebuilt = true;
    const words = await db.prepare("SELECT COUNT(*) as c FROM word_stats").first<{ c: number }>();
    return { detail: `${words?.c || 0} word stats rows`, counts: { word_stats_rows: words?.c || 0 } };
  });

  await runStep("topic_distinctiveness", steps, async () => {
    const touched = await syncTopicDistinctiveness(db);
    return { detail: `${touched} topics updated`, counts: { topics_updated: touched } };
  });

  await runStep("noise_cleanup", steps, async () => {
    const noiseCandidates = await db.prepare(
      "SELECT id, name, kind FROM topics WHERE usage_count > 0"
    ).all<{ id: number; name: string; kind: string }>();
    const noiseIds = noiseCandidates.results
      .filter((topic) => topic.kind !== "entity" && isNoiseTopic(topic.name))
      .map((topic) => topic.id);
    result.noise_removed = await pruneTopicIds(db, noiseIds, "noise_cleanup");
    return { detail: `${result.noise_removed} noise topics cleaned`, counts: { topics_pruned: result.noise_removed } };
  });

  await runStep("episode_spread_gate", steps, async () => {
    const toPrune = await db.prepare(
      `SELECT t.id
       FROM topics t
       WHERE t.kind != 'entity' AND t.usage_count > 0
         AND (
           SELECT COUNT(DISTINCT c.episode_id)
           FROM chunk_topics ct
           JOIN chunks c ON c.id = ct.chunk_id
           WHERE ct.topic_id = t.id
         ) < 2`
    ).all<{ id: number }>();
    const pruned = await pruneTopicIds(db, toPrune.results.map((topic) => topic.id), "low_episode_spread");
    return { detail: `${pruned} low-episode-spread topics pruned`, counts: { topics_pruned: pruned } };
  });

  await runStep("df_quality_gate", steps, async () => {
    const toPrune = await db.prepare(
      "SELECT id FROM topics WHERE usage_count < 5 AND kind != 'entity'"
    ).all<{ id: number }>();
    result.pruned = await pruneTopicIds(db, toPrune.results.map((topic) => topic.id), "low_support");
    return { detail: `${result.pruned} low-support topics pruned`, counts: { topics_pruned: result.pruned } };
  });

  await runStep("stem_merge", steps, async () => {
    const { simpleStem } = await import("../services/text-similarity");
    const activeTopics = await db.prepare(
      "SELECT id, name, slug, usage_count FROM topics WHERE usage_count > 0 AND kind != 'entity' ORDER BY usage_count DESC, id ASC"
    ).all<{ id: number; name: string; slug: string; usage_count: number }>();
    const stemGroups = new Map<string, typeof activeTopics.results>();
    for (const topic of activeTopics.results) {
      const stem = topic.name.includes(" ")
        ? topic.name.split(" ").map((word) => simpleStem(word)).join(" ")
        : simpleStem(topic.name);
      const group = stemGroups.get(stem) || [];
      group.push(topic);
      stemGroups.set(stem, group);
    }

    let merged = 0;
    for (const [, group] of stemGroups) {
      if (group.length <= 1) continue;
      const keep = group[0];
      for (const duplicate of group.slice(1)) {
        await mergeTopicInto(db, duplicate, keep, "stem_merge", "stem_equivalent");
        merged++;
      }
    }
    result.merged += merged;
    return { detail: `${merged} stem-equivalent topics merged`, counts: { topics_merged: merged } };
  });

  await runStep("similarity_cluster", steps, async () => {
    const { clusterBySimilarity } = await import("../services/text-similarity");
    const activeTopics = await db.prepare(
      "SELECT id, name, slug, usage_count FROM topics WHERE usage_count > 0 AND kind != 'entity' ORDER BY usage_count DESC, id ASC"
    ).all<{ id: number; name: string; slug: string; usage_count: number }>();
    if (activeTopics.results.length < 2) {
      return { detail: "0 clusters", counts: { topics_merged: 0 } };
    }
    const clusters = clusterBySimilarity(activeTopics.results.map((topic) => topic.name), 0.7);
    const byName = new Map(activeTopics.results.map((topic) => [topic.name, topic]));
    let merged = 0;
    for (const [name, canonical] of clusters) {
      if (name === canonical) continue;
      const fromTopic = byName.get(name);
      const toTopic = byName.get(canonical);
      if (!fromTopic || !toTopic) continue;
      await mergeTopicInto(db, fromTopic, toTopic, "similarity_cluster", "near_duplicate_string");
      merged++;
    }
    result.merged += merged;
    return { detail: `${merged} near-duplicate topics merged`, counts: { topics_merged: merged } };
  });

  await runStep("phrase_dedup", steps, async () => {
    const activeTopics = await db.prepare(
      "SELECT id, name, slug, usage_count FROM topics WHERE usage_count > 0 AND kind != 'entity' ORDER BY usage_count DESC, id ASC"
    ).all<{ id: number; name: string; slug: string; usage_count: number }>();
    const canonicalMap = new Map<string, { id: number; slug: string }>();
    let merged = 0;
    for (const topic of activeTopics.results) {
      const canonical = canonicalizeExistingTopicName(topic.name, "concept");
      const existing = canonicalMap.get(canonical.slug);
      if (existing && existing.id !== topic.id) {
        await mergeTopicInto(db, topic, existing, "phrase_dedup", "canonical_plural_duplicate");
        merged++;
        continue;
      }
      canonicalMap.set(canonical.slug, { id: topic.id, slug: topic.slug });
    }
    result.merged += merged;
    return { detail: `${merged} canonical duplicates merged`, counts: { topics_merged: merged } };
  });

  await runStep("delete_orphans", steps, async () => {
    let deleted = 0;
    const BATCH = 500;
    while (true) {
      const prune = await db.prepare(
        `DELETE FROM topics
         WHERE id IN (
           SELECT id FROM topics
           WHERE NOT EXISTS (SELECT 1 FROM chunk_topics WHERE topic_id = topics.id)
             AND NOT EXISTS (SELECT 1 FROM topic_candidate_audit WHERE topic_id = topics.id)
             AND NOT EXISTS (
               SELECT 1 FROM topic_merge_audit
               WHERE from_topic_id = topics.id OR to_topic_id = topics.id
             )
           LIMIT ?
         )`
      ).bind(BATCH).run();
      deleted += prune.meta.changes || 0;
      if ((prune.meta.changes || 0) === 0) break;
    }
    result.orphan_topics_deleted = deleted;
    return { detail: `${deleted} orphan topics deleted`, counts: { orphan_topics_deleted: deleted } };
  });

  await runStep("usage_recount_post_merge", steps, async () => {
    const touched = await recountUsage(db);
    return { detail: `${touched} topics recounted`, counts: { topics_recounted: touched } };
  });

  await runStep("archive_lineage_topics", steps, async () => {
    const archived = await archiveZeroUsageLineageTopics(db);
    result.archived_lineage_topics = archived;
    return {
      detail: `${archived} zero-usage lineage topics archived`,
      counts: { archived_lineage_topics: archived },
    };
  });

  await runStep("entity_validation", steps, async () => {
    const { escapeRegex } = await import("../lib/html");
    const entities = await db.prepare(
      "SELECT id, name FROM topics WHERE kind = 'entity' AND usage_count > 0"
    ).all<{ id: number; name: string }>();
    let deletedLinks = 0;
    for (const entity of entities.results) {
      const links = await db.prepare(
        `SELECT ct.chunk_id, COALESCE(c.analysis_text, c.content_plain) as analysis_text
         FROM chunk_topics ct
         JOIN chunks c ON ct.chunk_id = c.id
         WHERE ct.topic_id = ?`
      ).bind(entity.id).all<{ chunk_id: number; analysis_text: string }>();
      const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(entity.name.toLowerCase())}(?=$|[^a-z0-9])`, "i");
      const invalidChunkIds = links.results
        .filter((row) => !regex.test(row.analysis_text.toLowerCase()))
        .map((row) => row.chunk_id);
      if (invalidChunkIds.length === 0) continue;
      for (const invalidChunkIdBatch of chunkForSqlBindings(invalidChunkIds)) {
        const placeholders = sqlPlaceholders(invalidChunkIdBatch.length);
        const deletion = await db.prepare(
          `DELETE FROM chunk_topics WHERE topic_id = ? AND chunk_id IN (${placeholders})`
        ).bind(entity.id, ...invalidChunkIdBatch).run();
        deletedLinks += deletion.meta.changes || 0;
      }
    }
    await recountUsage(db);
    const entityFlagUpdates = entities.results.map((entity) =>
      db.prepare(
        `UPDATE topics
         SET entity_verified = CASE WHEN usage_count > 0 THEN 1 ELSE 0 END
         WHERE id = ?`
      ).bind(entity.id)
    );
    await batchExec(db, entityFlagUpdates);
    return { detail: `${deletedLinks} invalid entity links removed`, counts: { invalid_links_removed: deletedLinks } };
  });

  await runStep("provenance_flags", steps, async () => {
    await db.prepare(
      `UPDATE topics
       SET provenance_complete = CASE
         WHEN EXISTS (SELECT 1 FROM topic_candidate_audit WHERE topic_id = topics.id AND decision = 'accepted') THEN 1
         ELSE 0
       END`
    ).run();
    const coverage = await db.prepare(
      "SELECT COUNT(*) as c FROM topics WHERE usage_count > 0 AND provenance_complete = 1"
    ).first<{ c: number }>();
    result.provenance_complete_topics = coverage?.c || 0;
    return { detail: `${result.provenance_complete_topics} active topics with provenance`, counts: { provenance_complete_topics: result.provenance_complete_topics } };
  });

  await runStep("display_curation", steps, async () => {
    const activeTopics = await db.prepare(
      `SELECT id, slug, name, usage_count, distinctiveness, kind, hidden,
              (
                SELECT COUNT(DISTINCT c.episode_id)
                FROM chunk_topics ct
                JOIN chunks c ON c.id = ct.chunk_id
                WHERE ct.topic_id = topics.id
              ) AS episode_support
       FROM topics
       WHERE usage_count > 0`
    ).all<{ id: number; slug: string; name: string; usage_count: number; distinctiveness: number; kind: string; hidden: number; episode_support: number }>();
    const decisions = computeTopicDisplayDecisions(activeTopics.results);
    const updates = decisions.map((decision) =>
      db.prepare(
        `UPDATE topics
         SET display_suppressed = ?, hidden = ?, display_reason = ?
         WHERE slug = ?`
      ).bind(decision.displaySuppressed ? 1 : 0, decision.hidden ? 1 : 0, decision.reason, decision.slug)
    );
    await batchExec(db, updates);
    return {
      detail: `${decisions.filter((decision) => decision.displaySuppressed).length} topics suppressed for display`,
      counts: {
        display_suppressed: decisions.filter((decision) => decision.displaySuppressed).length,
        hidden_topics: decisions.filter((decision) => decision.hidden).length,
      },
    };
  });

  await runStep("reach_precompute", steps, async () => {
    await db.prepare("UPDATE chunks SET reach = 0").run();
    const chunkIds = await db.prepare(
      "SELECT DISTINCT chunk_id as id FROM chunk_topics"
    ).all<{ id: number }>();
    const ids = chunkIds.results.map((row) => row.id);
    const BATCH = 90;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      await db.prepare(
        `UPDATE chunks
         SET reach = (
           SELECT COALESCE(SUM(t.usage_count), 0)
           FROM chunk_topics ct
           JOIN topics t ON ct.topic_id = t.id
           WHERE ct.chunk_id = chunks.id AND t.hidden = 0 AND t.display_suppressed = 0
         )
         WHERE id IN (${placeholders})`
      ).bind(...batch).run();
    }
    return { detail: `${ids.length} chunks updated`, counts: { chunks_updated: ids.length } };
  });

  await runStep("related_slugs", steps, async () => {
    try {
      await db.prepare(
        `UPDATE topics
         SET related_slugs = (
           SELECT '[' || GROUP_CONCAT('"' || related.slug || '"') || ']'
           FROM (
             SELECT t.slug, COUNT(*) as cnt
             FROM chunk_topics ct1
             JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
             JOIN topics t ON ct2.topic_id = t.id
             WHERE ct1.topic_id = topics.id AND t.hidden = 0 AND t.display_suppressed = 0
             GROUP BY ct2.topic_id
             ORDER BY cnt DESC
             LIMIT 5
           ) related
         )
         WHERE usage_count >= 5 AND hidden = 0 AND display_suppressed = 0`
      ).run();
      result.related_slugs_method = "batch_sql";
      return { detail: "batch_sql", counts: { visible_topics_updated: 1 } };
    } catch {
      if (queue) {
        const topics = await db.prepare(
          "SELECT id FROM topics WHERE usage_count >= 5 AND hidden = 0 AND display_suppressed = 0"
        ).all<{ id: number }>();
        const messages = topics.results.map((topic) => ({ body: { type: "compute-related" as const, topicId: topic.id } }));
        for (let i = 0; i < messages.length; i += 25) {
          await queue.sendBatch(messages.slice(i, i + 25));
        }
        result.related_slugs_method = "queue";
        return { detail: `queue (${topics.results.length} topics)`, counts: { visible_topics_updated: topics.results.length } };
      }

      const visibleTopics = await db.prepare(
        "SELECT id FROM topics WHERE usage_count >= 5 AND hidden = 0 AND display_suppressed = 0"
      ).all<{ id: number }>();
      const updates: D1PreparedStatement[] = [];
      for (const topic of visibleTopics.results) {
        const related = await db.prepare(
          `SELECT t.slug
           FROM chunk_topics ct1
           JOIN chunk_topics ct2 ON ct1.chunk_id = ct2.chunk_id AND ct1.topic_id != ct2.topic_id
           JOIN topics t ON ct2.topic_id = t.id
           WHERE ct1.topic_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
           GROUP BY ct2.topic_id
           ORDER BY COUNT(*) DESC
           LIMIT 5`
        ).bind(topic.id).all<{ slug: string }>();
        updates.push(
          db.prepare("UPDATE topics SET related_slugs = ? WHERE id = ?").bind(JSON.stringify(related.results.map((row) => row.slug)), topic.id)
        );
      }
      await batchExec(db, updates);
      result.related_slugs_method = "inline";
      return { detail: `inline (${visibleTopics.results.length} topics)`, counts: { visible_topics_updated: visibleTopics.results.length } };
    }
  });

  result.audit_report = (await db.prepare(
    `SELECT chunk_id, source, raw_candidate, normalized_candidate, decision, decision_reason
     FROM topic_candidate_audit
     ORDER BY id DESC
     LIMIT 10`
  ).all<PipelineAuditSample>()).results;
  result.total_ms = Date.now() - totalStart;
  return result;
}

/**
 * Enrich all unenriched chunks within a time budget.
 * Loops internally — no need for the caller to loop.
 */
export async function enrichAllChunks(
  db: D1Database,
  batchSize = 100,
  maxMs = 25000,
  onBatch?: (batch: ProcessChunkBatchResult) => void,
  extractorMode: TopicExtractorMode = "naive"
): Promise<number> {
  let total = 0;
  let lastProcessed = -1;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const result = await enrichChunks(db, batchSize, extractorMode);
    if (result.chunksProcessed === 0) break;
    if (result.batch && onBatch) {
      onBatch(result.batch);
    }
    // Prevent infinite loop: if we processed the same count twice, some chunks can't be enriched
    if (result.chunksProcessed === lastProcessed) break;
    lastProcessed = result.chunksProcessed;
    total += result.chunksProcessed;
  }
  return total;
}

/**
 * Check if all chunks have been enriched (have topics).
 */
export async function isEnrichmentComplete(db: D1Database): Promise<boolean> {
  return isEnrichmentDone(db);
}

/**
 * Legacy: full pipeline (used by /api/ingest for manual ingestion).
 * Calls Phase 1 + Phase 2 in sequence.
 */
export async function ingestParsedEpisodes(
  env: Bindings,
  sourceId: number,
  episodes: ParsedEpisode[]
): Promise<IngestParsedEpisodesResult> {
  const result = await ingestEpisodesOnly(env.DB, sourceId, episodes);
  const extractorMode = normalizeTopicExtractorMode(env.TOPIC_EXTRACTOR_MODE);
  let enrichBatch: ProcessChunkBatchResult | undefined;
  let finalize: FinalizeResult | undefined;

  if (result.chunksAdded > 0) {
    await enrichEpisodesWithLlm(env, sourceId, result.insertedEpisodes);
    const enrichResult = await enrichChunks(env.DB, 10000, extractorMode);
    enrichBatch = enrichResult.batch;
    finalize = await finalizeEnrichment(env.DB, env.ENRICHMENT_QUEUE);
    const failedSteps = finalize.steps.filter((step) => step.status === "error");
    if (failedSteps.length > 0) {
      throw new Error(`Finalization failed in steps: ${failedSteps.map((step) => step.name).join(", ")}`);
    }

    // Embeddings (optional, may fail)
    try {
      if (env.AI && env.VECTORIZE) {
        const unembed = await env.DB.prepare(
          "SELECT id, content_plain, vector_id FROM chunks WHERE vector_id IS NOT NULL LIMIT 100"
        ).all();
        if (unembed.results.length > 0) {
          const texts = (unembed.results as any[]).map((c) => c.content_plain);
          const embeddings = await generateEmbeddings(env.AI, texts);
          const vectors = (unembed.results as any[]).map((c, i) => ({
            id: c.vector_id,
            values: embeddings[i],
            metadata: { chunkId: c.id },
          }));
          await env.VECTORIZE.upsert(vectors);
        }
      }
    } catch (e) {
      console.error("Embedding error:", e);
    }
  }

  return {
    ...result,
    ...(enrichBatch ? { enrichBatch } : {}),
    ...(finalize ? { finalize } : {}),
  };
}

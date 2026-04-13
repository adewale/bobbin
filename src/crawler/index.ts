/**
 * Crawler module — the content acquisition pipeline.
 *
 * Separated into three stages:
 *   fetch.ts  — HTTP fetching (no side effects)
 *   parse.ts  — HTML → structured data (no I/O)
 *   ingest.ts — structured data → D1 + Vectorize
 */
export { fetchGoogleDoc, type FetchResult } from "./fetch";
export { parseHtmlDocument, extractDocLinksFromHtml } from "./parse";
export { ingestEpisodesOnly, enrichChunks, finalizeEnrichment, isEnrichmentComplete, ingestParsedEpisodes } from "./ingest";

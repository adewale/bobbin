import fs from "node:fs";
import process from "node:process";
import { KNOWN_SOURCES } from "../src/data/source-registry";
import { parseHtmlDocument } from "../src/services/html-parser";

interface SourceAuditRow {
  docId: string;
  registryTitle: string;
  sourceTitle: string;
  episodes: number;
  chunks: number;
  titleLooksKomoroske: boolean;
  fromLocalFixture: boolean;
}

async function loadHtml(docId: string): Promise<{ html: string; fromLocalFixture: boolean }> {
  const localPath = `./data/raw/${docId}.html`;
  if (fs.existsSync(localPath)) {
    return { html: fs.readFileSync(localPath, "utf8"), fromLocalFixture: true };
  }

  const response = await fetch(`https://docs.google.com/document/d/${docId}/mobilebasic`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${docId}: ${response.status}`);
  }
  return { html: await response.text(), fromLocalFixture: false };
}

async function auditDoc(docId: string, registryTitle: string): Promise<SourceAuditRow> {
  const { html, fromLocalFixture } = await loadHtml(docId);
  const sourceTitle = (html.match(/<title>([^<]+)/i)?.[1] || "").replace(/&#39;/g, "'");
  const episodes = parseHtmlDocument(html);
  const chunks = episodes.reduce((sum, episode) => sum + episode.chunks.length, 0);

  return {
    docId,
    registryTitle,
    sourceTitle,
    episodes: episodes.length,
    chunks,
    titleLooksKomoroske: /komoroske\.com\/bits-and-bobs/i.test(sourceTitle),
    fromLocalFixture,
  };
}

async function main() {
  const requestedDocIds = process.argv.slice(2);
  const requested = requestedDocIds.length > 0
    ? requestedDocIds.map((docId) => ({ docId, registryTitle: requestedDocIds.length === 1 && docId === "1IPwKwmEgrL6R2lVe9IaPIu0sPB4O_ZNy8ZA0N0W3yw0" ? "Excluded source" : "Ad hoc audit" }))
    : KNOWN_SOURCES.map((source) => ({ docId: source.docId, registryTitle: source.title }));

  const rows = [] as SourceAuditRow[];
  for (const source of requested) {
    rows.push(await auditDoc(source.docId, source.registryTitle));
  }

  console.log(JSON.stringify({
    totalSources: rows.length,
    totalEpisodes: rows.reduce((sum, row) => sum + row.episodes, 0),
    totalChunks: rows.reduce((sum, row) => sum + row.chunks, 0),
    allTitlesLookKomoroske: rows.every((row) => row.titleLooksKomoroske),
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

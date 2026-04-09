import { fetchGoogleDocHtml } from "../services/google-docs";
import { parseHtmlDocument, extractDocLinksFromHtml } from "../services/html-parser";
import { ingestParsedEpisodes } from "./ingest";
import type { Bindings, SourceRow } from "../types";

export async function runRefresh(env: Bindings): Promise<void> {
  const sources = await env.DB.prepare("SELECT * FROM sources").all();

  if (!sources.results.length) {
    await seedInitialSources(env.DB);
    return runRefresh(env);
  }

  const logResult = await env.DB.prepare(
    "INSERT INTO ingestion_log (status) VALUES ('running')"
  ).run();
  const logId = logResult.meta.last_row_id;

  let totalEpisodes = 0;
  let totalChunks = 0;

  try {
    for (const source of sources.results as unknown as SourceRow[]) {
      const html = await fetchGoogleDocHtml(source.google_doc_id);

      const episodes = parseHtmlDocument(html);
      const result = await ingestParsedEpisodes(env, source.id, episodes);
      totalEpisodes += result.episodesAdded;
      totalChunks += result.chunksAdded;

      // Discover new source docs from links
      const newDocIds = extractDocLinksFromHtml(html);
      for (const docId of newDocIds) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO sources (google_doc_id, title, is_archive) VALUES (?, ?, 1)"
        )
          .bind(docId, `Archive (${docId.substring(0, 8)}...)`)
          .run();
      }

      await env.DB.prepare(
        "UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?"
      )
        .bind(source.id)
        .run();
    }

    await env.DB.prepare(
      `UPDATE ingestion_log SET status = 'completed', completed_at = datetime('now'),
       episodes_added = ?, chunks_added = ? WHERE id = ?`
    )
      .bind(totalEpisodes, totalChunks, logId)
      .run();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      `UPDATE ingestion_log SET status = 'failed', completed_at = datetime('now'),
       error_message = ? WHERE id = ?`
    )
      .bind(msg, logId)
      .run();
    throw error;
  }
}

async function seedInitialSources(db: D1Database): Promise<void> {
  const knownDocs = [
    {
      id: "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA",
      title: "Bits and Bobs (Current)",
      isArchive: 0,
    },
    {
      id: "1ptHfoKWn0xbNSJgdkH8_3z4PHLC_f36MutFTTRf14I0",
      title: "Bits and Bobs (Archive 1)",
      isArchive: 1,
    },
    {
      id: "1GrEFrdF_IzRVXbGH1lG0aQMlvsB71XihPPqQN-ONTuo",
      title: "Bits and Bobs (Archive 2)",
      isArchive: 1,
    },
  ];

  for (const doc of knownDocs) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO sources (google_doc_id, title, is_archive) VALUES (?, ?, ?)"
      )
      .bind(doc.id, doc.title, doc.isArchive)
      .run();
  }
}

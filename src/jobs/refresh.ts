import { fetchGoogleDoc, parseHtmlDocument, ingestEpisodesOnly, enrichAllChunks, finalizeEnrichment } from "../crawler";
import { ensureSource, getSourceByDocId, updateSourceFetchedAt } from "../db/sources";
import { createIngestionLog, completeIngestionLog, failIngestionLog } from "../db/ingestion";
import type { Bindings } from "../types";

const CURRENT_DOC_ID = "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA";

export async function runRefresh(env: Bindings): Promise<void> {
  await ensureSource(env.DB, CURRENT_DOC_ID, "Bits and Bobs (Current)");
  const source = await getSourceByDocId(env.DB, CURRENT_DOC_ID);
  if (!source) return;

  const logId = await createIngestionLog(env.DB, source.id);

  try {
    const fetched = await fetchGoogleDoc(source.google_doc_id);
    const episodes = parseHtmlDocument(fetched.html);
    const result = await ingestEpisodesOnly(env.DB, source.id, episodes);

    // Enrich new chunks (with time budget) + finalization (uses queue for slow steps)
    await enrichAllChunks(env.DB, 200, 120000);
    await finalizeEnrichment(env.DB, env.ENRICHMENT_QUEUE);

    await updateSourceFetchedAt(env.DB, source.id);
    await completeIngestionLog(env.DB, logId, result.episodesAdded, result.chunksAdded);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Refresh failed:", msg);
    await failIngestionLog(env.DB, logId, msg);
  }
}

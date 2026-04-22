import { execFileSync } from "node:child_process";

const ACCOUNT_ID = "8837d43caf5a2ab3df5143eb3e2f1b96";
const DB_ID = "b1e1d8be-b82b-4e10-a97a-37bd8d48c6f1";
const TOPIC_SLUG = process.argv[2] || "claude";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!API_TOKEN) {
  throw new Error("CLOUDFLARE_API_TOKEN is required");
}

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function remoteQuery(sql, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const body = await response.json();
  if (!response.ok || body.success === false || body.errors?.length) {
    throw new Error(JSON.stringify(body.errors || body));
  }
  return body.result?.[0]?.results || body[0]?.results || body.results || [];
}

function localExec(sqlStatements) {
  const joined = sqlStatements.join(" ");
  execFileSync("npx", ["wrangler", "d1", "execute", "bobbin-db", "--local", "--command", joined], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

function localQuery(sql) {
  const output = execFileSync("npx", ["wrangler", "d1", "execute", "bobbin-db", "--local", "--command", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const jsonStart = output.indexOf("[");
  const jsonEnd = output.lastIndexOf("]");
  const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  return parsed?.[0]?.results || [];
}

function chunked(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const topicRows = await remoteQuery(
  "SELECT id, name, slug, usage_count, kind, related_slugs, display_suppressed, display_reason, hidden, entity_verified, provenance_complete, distinctiveness FROM topics WHERE slug = ?",
  [TOPIC_SLUG],
);

if (topicRows.length === 0) {
  throw new Error(`No topic found for slug ${TOPIC_SLUG}`);
}

const topic = topicRows[0];

const wordStatsRows = await remoteQuery(
  "SELECT word, total_count, doc_count, distinctiveness, in_baseline FROM word_stats WHERE word = ?",
  [topic.name.toLowerCase()],
);

const topicChunks = await remoteQuery(
  `SELECT c.id, c.episode_id, c.slug, c.title, c.content, c.content_plain, c.summary, c.position, c.word_count,
          c.content_markdown, c.rich_content_json, c.links_json, c.images_json, c.footnotes_json,
          e.source_id, e.slug AS episode_slug, e.title AS episode_title, e.published_date, e.year, e.month, e.day, e.chunk_count, e.format
   FROM chunks c
   JOIN chunk_topics ct ON c.id = ct.chunk_id
   JOIN episodes e ON c.episode_id = e.id
   WHERE ct.topic_id = ?
   ORDER BY e.published_date DESC, c.position ASC`,
  [topic.id],
);

const episodes = Array.from(new Map(topicChunks.map((row) => [row.episode_id, {
  id: row.episode_id,
  source_id: row.source_id,
  slug: row.episode_slug,
  title: row.episode_title,
  published_date: row.published_date,
  year: row.year,
  month: row.month,
  day: row.day,
  chunk_count: row.chunk_count,
  format: row.format,
}])).values());

const sourceIds = [...new Set(episodes.map((row) => row.source_id))];
const sourceRows = [];
for (const batch of chunked(sourceIds, 50)) {
  const placeholders = batch.map(() => "?").join(",");
  const rows = await remoteQuery(
    `SELECT id, google_doc_id, title, is_archive FROM sources WHERE id IN (${placeholders})`,
    batch,
  );
  sourceRows.push(...rows);
}

const localSources = localQuery("SELECT id, google_doc_id FROM sources;");
const localSourceIdByGoogleDocId = new Map(localSources.map((row) => [row.google_doc_id, row.id]));
const remoteSourceIdToLocalSourceId = new Map(sourceRows.map((row) => {
  const localId = localSourceIdByGoogleDocId.get(row.google_doc_id);
  if (!localId) throw new Error(`Missing local source for google_doc_id ${row.google_doc_id}`);
  return [row.id, localId];
}));

const mappedEpisodes = episodes.map((row) => ({
  ...row,
  source_id: remoteSourceIdToLocalSourceId.get(row.source_id) || row.source_id,
}));

const claudeChunkIds = topicChunks.map((row) => row.id);
const chunkTopicRows = [];
for (const batch of chunked(claudeChunkIds, 50)) {
  const placeholders = batch.map(() => "?").join(",");
  const rows = await remoteQuery(
    `SELECT chunk_id, topic_id FROM chunk_topics WHERE chunk_id IN (${placeholders}) ORDER BY chunk_id, topic_id`,
    batch,
  );
  chunkTopicRows.push(...rows);
}

const relatedTopicIds = [...new Set(chunkTopicRows.map((row) => row.topic_id))];
const allTopicRows = [];
for (const batch of chunked(relatedTopicIds, 50)) {
  const placeholders = batch.map(() => "?").join(",");
  const rows = await remoteQuery(
    `SELECT id, name, slug, usage_count, kind, related_slugs, display_suppressed, display_reason, hidden, entity_verified, provenance_complete, distinctiveness
     FROM topics WHERE id IN (${placeholders})`,
    batch,
  );
  allTopicRows.push(...rows);
}

const localTopics = localQuery("SELECT id, slug FROM topics;");
const localTopicIdBySlug = new Map(localTopics.map((row) => [row.slug, row.id]));
const remoteTopicIdToLocalTopicId = new Map(allTopicRows.map((row) => [row.id, localTopicIdBySlug.get(row.slug) || row.id]));
const mappedTopic = {
  ...topic,
  id: remoteTopicIdToLocalTopicId.get(topic.id) || topic.id,
};

const mappedTopicRows = allTopicRows.map((row) => ({
  ...row,
  id: remoteTopicIdToLocalTopicId.get(row.id) || row.id,
}));

const mappedChunkTopicRows = chunkTopicRows.map((row) => ({
  ...row,
  topic_id: remoteTopicIdToLocalTopicId.get(row.topic_id) || row.topic_id,
}));

const sql = [];

sql.push(`DELETE FROM word_stats WHERE word = ${sqlValue(topic.name.toLowerCase())};`);

for (const row of mappedTopicRows) {
  sql.push(
    `INSERT INTO topics (id, name, slug, usage_count, kind, related_slugs, display_suppressed, display_reason, hidden, entity_verified, provenance_complete, distinctiveness)
     VALUES (${row.id}, ${sqlValue(row.name)}, ${sqlValue(row.slug)}, ${row.usage_count || 0}, ${sqlValue(row.kind || "concept")}, ${sqlValue(row.related_slugs)}, ${row.display_suppressed || 0}, ${sqlValue(row.display_reason)}, ${row.hidden || 0}, ${row.entity_verified || 0}, ${row.provenance_complete || 0}, ${row.distinctiveness || 0})
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       slug = excluded.slug,
       usage_count = excluded.usage_count,
       kind = excluded.kind,
       related_slugs = excluded.related_slugs,
       display_suppressed = excluded.display_suppressed,
       display_reason = excluded.display_reason,
       hidden = excluded.hidden,
       entity_verified = excluded.entity_verified,
       provenance_complete = excluded.provenance_complete,
       distinctiveness = excluded.distinctiveness;`,
  );
}

for (const row of mappedEpisodes) {
  sql.push(
    `INSERT INTO episodes (id, source_id, slug, title, published_date, year, month, day, chunk_count, format)
     VALUES (${row.id}, ${row.source_id}, ${sqlValue(row.slug)}, ${sqlValue(row.title)}, ${sqlValue(row.published_date)}, ${row.year}, ${row.month}, ${row.day}, ${row.chunk_count || 0}, ${sqlValue(row.format || "notes")})
     ON CONFLICT(id) DO UPDATE SET
       source_id = excluded.source_id,
       slug = excluded.slug,
       title = excluded.title,
       published_date = excluded.published_date,
       year = excluded.year,
       month = excluded.month,
       day = excluded.day,
       chunk_count = excluded.chunk_count,
       format = excluded.format;`,
  );
  sql.push(
    `INSERT OR IGNORE INTO episode_topics (episode_id, topic_id) VALUES (${row.id}, ${mappedTopic.id});`,
  );
}

for (const row of topicChunks) {
  sql.push(
    `INSERT INTO chunks (id, episode_id, slug, title, content, content_plain, summary, position, word_count, content_markdown, rich_content_json, links_json, images_json, footnotes_json)
     VALUES (${row.id}, ${row.episode_id}, ${sqlValue(row.slug)}, ${sqlValue(row.title)}, ${sqlValue(row.content)}, ${sqlValue(row.content_plain)}, ${sqlValue(row.summary)}, ${row.position || 0}, ${row.word_count || 0}, ${sqlValue(row.content_markdown)}, ${sqlValue(row.rich_content_json)}, ${sqlValue(row.links_json)}, ${sqlValue(row.images_json)}, ${sqlValue(row.footnotes_json)})
     ON CONFLICT(id) DO UPDATE SET
       episode_id = excluded.episode_id,
       slug = excluded.slug,
       title = excluded.title,
       content = excluded.content,
       content_plain = excluded.content_plain,
       summary = excluded.summary,
       position = excluded.position,
       word_count = excluded.word_count,
       content_markdown = excluded.content_markdown,
       rich_content_json = excluded.rich_content_json,
       links_json = excluded.links_json,
       images_json = excluded.images_json,
       footnotes_json = excluded.footnotes_json;`,
  );
}

for (const row of mappedChunkTopicRows) {
  sql.push(`INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (${row.chunk_id}, ${row.topic_id});`);
}

for (const row of wordStatsRows) {
  sql.push(
    `INSERT INTO word_stats (word, total_count, doc_count, distinctiveness, in_baseline) VALUES (${sqlValue(row.word)}, ${row.total_count || 0}, ${row.doc_count || 0}, ${row.distinctiveness || 0}, ${row.in_baseline || 0});`,
  );
}

for (const batch of chunked(sql, 40)) {
  localExec(batch);
}

console.log(JSON.stringify({
  topic: topic.slug,
  sourceRows: mappedEpisodes.length ? new Set(mappedEpisodes.map((row) => row.source_id)).size : 0,
  topics: mappedTopicRows.length,
  episodes: mappedEpisodes.length,
  chunks: topicChunks.length,
  chunkTopics: mappedChunkTopicRows.length,
}, null, 2));

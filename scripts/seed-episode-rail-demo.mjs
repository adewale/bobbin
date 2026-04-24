import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const configFlagIndex = args.indexOf("--config");
const CONFIG_PATH = configFlagIndex >= 0 ? args[configFlagIndex + 1] : "wrangler.jsonc";

const SOURCE_DOC_ID = "episode-rail-demo-source";
const PREV_SLUG = "2026-05-05-rail-demo";
const CURR_SLUG = "2026-05-12-rail-demo";

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function localExec(sqlStatements) {
  const joined = sqlStatements.join(" ");
  execFileSync("npx", ["wrangler", "d1", "execute", "bobbin-db", "--local", "--config", CONFIG_PATH, "--command", joined], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

function localQuery(sql) {
  const output = execFileSync("npx", ["wrangler", "d1", "execute", "bobbin-db", "--local", "--config", CONFIG_PATH, "--command", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const jsonStart = output.indexOf("[");
  const jsonEnd = output.lastIndexOf("]");
  const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  return parsed?.[0]?.results || [];
}

const topics = [
  { name: "browser agents demo", slug: "browser-agents-demo", usage_count: 9, distinctiveness: 2.6 },
  { name: "workflow custody demo", slug: "workflow-custody-demo", usage_count: 8, distinctiveness: 2.1 },
  { name: "coordination debt demo", slug: "coordination-debt-demo", usage_count: 7, distinctiveness: 2.8 },
  { name: "vendor memory demo", slug: "vendor-memory-demo", usage_count: 6, distinctiveness: 1.9 },
  { name: "trace replay demo", slug: "trace-replay-demo", usage_count: 6, distinctiveness: 2.0 },
  { name: "prompt injection attack demo", slug: "prompt-injection-attack-demo", usage_count: 7, distinctiveness: 3.3 },
  { name: "compliance theatre demo", slug: "compliance-theatre-demo", usage_count: 6, distinctiveness: 2.9 },
  { name: "agent swarms demo", slug: "agent-swarms-demo", usage_count: 6, distinctiveness: 2.4 },
];

const episodes = [
  {
    slug: PREV_SLUG,
    title: "Bits and Bobs 5/05/26 Demo",
    published_date: "2026-05-05",
    year: 2026,
    month: 5,
    day: 5,
    format: "notes",
    chunks: [
      {
        slug: "rail-demo-prev-0",
        title: "Browser agents keep leaking intent",
        body: "Why do browser agents keep leaking user intent into the wrong workflow? One answer is that workflow custody is still weak.",
        links: [
          { href: "https://example.com/agents-intent", text: "agents intent leak" },
        ],
        topics: ["browser-agents-demo", "workflow-custody-demo"],
      },
      {
        slug: "rail-demo-prev-1",
        title: "Coordination debt is mostly hidden handoff debt",
        body: "What looks like execution speed is often coordination debt moving out of sight.",
        links: [],
        topics: ["coordination-debt-demo", "workflow-custody-demo"],
      },
      {
        slug: "rail-demo-prev-2",
        title: "Vendor memory is becoming the new lock-in surface",
        body: "Vendor memory compounds because teams forget how much context they have externalized.",
        links: [{ href: "https://example.com/vendor-memory", text: "vendor memory note" }],
        topics: ["vendor-memory-demo"],
      },
      {
        slug: "rail-demo-prev-3",
        title: "Trace replay still matters more than dashboards",
        body: "If you cannot replay the trace, can you really understand the failure?",
        links: [{ href: "https://example.com/trace-replay", text: "trace replay" }],
        topics: ["trace-replay-demo", "browser-agents-demo"],
      },
    ],
  },
  {
    slug: CURR_SLUG,
    title: "Bits and Bobs 5/12/26 Demo",
    published_date: "2026-05-12",
    year: 2026,
    month: 5,
    day: 12,
    format: "notes",
    chunks: [
      {
        slug: "rail-demo-current-0",
        title: "Workflow custody breaks first when browser agents improvise",
        body: "Why do browser agents look competent right until they improvise? How much of that is really workflow custody failing at the boundary?",
        links: [
          { href: "https://example.com/browser-agents", text: "browser agents field report" },
          { href: "https://example.com/workflow-custody", text: "workflow custody memo" },
        ],
        topics: ["browser-agents-demo", "workflow-custody-demo"],
      },
      {
        slug: "rail-demo-current-1",
        title: "Prompt injection is becoming compliance theatre for agent teams",
        body: "What happens when prompt injection attack checklists become compliance theatre? Teams ask whether the ritual looks serious, not whether the system is safe.",
        links: [
          { href: "https://example.com/prompt-injection", text: "prompt injection roundup" },
          { href: "https://example.com/compliance-theatre", text: "compliance theatre explainer" },
          { href: "https://example.com/agent-policy", text: "agent policy note" },
        ],
        topics: ["prompt-injection-attack-demo", "compliance-theatre-demo", "workflow-custody-demo"],
      },
      {
        slug: "rail-demo-current-2",
        title: "Agent swarms create new forms of coordination debt",
        body: "Can agent swarms reduce coordination debt, or do they just launder it into monitoring overhead?",
        links: [
          { href: "https://example.com/agent-swarms", text: "agent swarms paper" },
        ],
        topics: ["agent-swarms-demo", "coordination-debt-demo"],
      },
      {
        slug: "rail-demo-current-3",
        title: "The most generative ideas are the ones that change the operating boundary",
        body: "Which ideas here seem likely to spawn future threads? Usually the answer is: the ones that change who holds the workflow boundary and how the trace can be replayed later.",
        links: [
          { href: "https://example.com/boundary-change", text: "boundary change note" },
        ],
        topics: ["workflow-custody-demo", "trace-replay-demo", "prompt-injection-attack-demo"],
      },
      {
        slug: "rail-demo-current-4",
        title: "Roundup: six links that make the problem feel more real",
        body: "Why does the problem feel more real this week? Because the external evidence is stacking up in multiple domains.",
        links: [
          { href: "https://example.com/link-1", text: "case study one" },
          { href: "https://example.com/link-2", text: "case study two" },
          { href: "https://example.com/link-3", text: "case study three" },
          { href: "https://example.com/link-4", text: "case study four" },
          { href: "https://example.com/link-5", text: "case study five" },
          { href: "https://example.com/link-6", text: "case study six" },
        ],
        topics: ["prompt-injection-attack-demo", "compliance-theatre-demo", "agent-swarms-demo"],
      },
      {
        slug: "rail-demo-current-5",
        title: "What do we stop measuring if trace replay becomes the real primitive?",
        body: "If trace replay becomes the primitive, what metrics become decorative? What should teams stop pretending they know?",
        links: [
          { href: "https://example.com/replay-metrics", text: "replay metrics" },
          { href: "https://example.com/replay-systems", text: "replay systems" },
        ],
        topics: ["trace-replay-demo", "workflow-custody-demo", "coordination-debt-demo"],
      },
      {
        slug: "rail-demo-current-6",
        title: "Vendor memory is gone, but the lock-in problem remains",
        body: "The explicit vendor memory story faded this week, but the lock-in question is still hiding inside workflow custody and compliance theatre.",
        links: [],
        topics: ["workflow-custody-demo", "compliance-theatre-demo"],
      },
    ],
  },
];

localExec([
  `INSERT OR IGNORE INTO sources (google_doc_id, title, is_archive) VALUES (${sqlValue(SOURCE_DOC_ID)}, 'Episode Rail Demo Source', 0);`,
]);

const source = localQuery(`SELECT id FROM sources WHERE google_doc_id = ${sqlValue(SOURCE_DOC_ID)};`)[0];
if (!source?.id) throw new Error("Failed to create or locate demo source");

localExec([
  `DELETE FROM chunk_topics WHERE chunk_id IN (SELECT c.id FROM chunks c JOIN episodes e ON c.episode_id = e.id WHERE e.slug IN (${sqlValue(PREV_SLUG)}, ${sqlValue(CURR_SLUG)}));`,
  `DELETE FROM chunks WHERE episode_id IN (SELECT id FROM episodes WHERE slug IN (${sqlValue(PREV_SLUG)}, ${sqlValue(CURR_SLUG)}));`,
  `DELETE FROM episode_topics WHERE episode_id IN (SELECT id FROM episodes WHERE slug IN (${sqlValue(PREV_SLUG)}, ${sqlValue(CURR_SLUG)}));`,
  `DELETE FROM episodes WHERE slug IN (${sqlValue(PREV_SLUG)}, ${sqlValue(CURR_SLUG)});`,
]);

for (const topic of topics) {
  localExec([
    `INSERT INTO topics (name, slug, usage_count, distinctiveness)
     VALUES (${sqlValue(topic.name)}, ${sqlValue(topic.slug)}, ${topic.usage_count}, ${topic.distinctiveness})
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       usage_count = excluded.usage_count,
       distinctiveness = excluded.distinctiveness;`,
  ]);
}

for (const episode of episodes) {
  localExec([
    `INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format)
     VALUES (${source.id}, ${sqlValue(episode.slug)}, ${sqlValue(episode.title)}, ${sqlValue(episode.published_date)}, ${episode.year}, ${episode.month}, ${episode.day}, ${episode.chunks.length}, ${sqlValue(episode.format)});`,
  ]);
}

const topicRows = localQuery(`SELECT id, slug FROM topics WHERE slug IN (${topics.map((topic) => sqlValue(topic.slug)).join(", ")});`);
const topicIdBySlug = new Map(topicRows.map((row) => [row.slug, row.id]));

for (const episode of episodes) {
  const episodeRow = localQuery(`SELECT id FROM episodes WHERE slug = ${sqlValue(episode.slug)};`)[0];
  if (!episodeRow?.id) throw new Error(`Missing episode ${episode.slug}`);

  const episodeTopicIds = new Set();
  for (let index = 0; index < episode.chunks.length; index += 1) {
    const chunk = episode.chunks[index];
    const content = `${chunk.title}\n\n${chunk.body}`;
    localExec([
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, links_json)
       VALUES (${episodeRow.id}, ${sqlValue(chunk.slug)}, ${sqlValue(chunk.title)}, ${sqlValue(content)}, ${sqlValue(chunk.body)}, ${index}, ${sqlValue(JSON.stringify(chunk.links))});`,
    ]);

    const chunkRow = localQuery(`SELECT id FROM chunks WHERE slug = ${sqlValue(chunk.slug)};`)[0];
    if (!chunkRow?.id) throw new Error(`Missing chunk ${chunk.slug}`);

    for (const topicSlug of chunk.topics) {
      const topicId = topicIdBySlug.get(topicSlug);
      if (!topicId) throw new Error(`Missing topic ${topicSlug}`);
      episodeTopicIds.add(topicId);
      localExec([
        `INSERT OR IGNORE INTO chunk_topics (chunk_id, topic_id) VALUES (${chunkRow.id}, ${topicId});`,
      ]);
    }
  }

  for (const topicId of episodeTopicIds) {
    localExec([
      `INSERT OR IGNORE INTO episode_topics (episode_id, topic_id) VALUES (${episodeRow.id}, ${topicId});`,
    ]);
  }
}

console.log(JSON.stringify({
  source: SOURCE_DOC_ID,
  episodes: episodes.map((episode) => ({ slug: episode.slug, title: episode.title, chunks: episode.chunks.length })),
  previewUrl: `http://localhost:9090/episodes/${CURR_SLUG}`,
}, null, 2));

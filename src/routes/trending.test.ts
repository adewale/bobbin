import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";

/**
 * Seed data for trending tests.
 *
 * Creates 10 episodes. Topic "agent" (usage_count=10, appearing in 8 episodes at 1 chunk each)
 * has a corpus average of 10/10 = 1 chunk per episode. In the "spike" episode (episode 1),
 * we put 5 "agent" chunks, giving a spike ratio of 5 / 1 = 5.0x.
 *
 * Topic "llms" (usage_count=10) appears evenly: 1 chunk per episode across all 10 episodes.
 * Spike ratio in any episode = 1 / (10/10) = 1.0x -- not trending.
 *
 * Topic "rare" (usage_count=3) has < 5 usage_count so it should be excluded.
 */
async function seedTrendingData() {
  const stmts: D1PreparedStatement[] = [];

  // Source
  stmts.push(env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('doc1', 'Source 1')"));

  // 10 episodes
  for (let i = 1; i <= 10; i++) {
    const day = String(i).padStart(2, "0");
    stmts.push(
      env.DB.prepare(
        `INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format)
         VALUES (1, '2025-01-${day}-ep', 'Episode ${i}', '2025-01-${day}', 2025, 1, ${i}, 5, 'notes')`
      )
    );
  }

  // Topics
  stmts.push(env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('agent', 'agent', 10)"));
  stmts.push(env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('llms', 'llms', 10)"));
  stmts.push(env.DB.prepare("INSERT INTO topics (name, slug, usage_count) VALUES ('rare', 'rare', 3)"));

  // Episode 1 (the spike episode): 5 chunks with "agent", 1 chunk with "llms"
  for (let j = 0; j < 5; j++) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'agent-chunk-${j}-2025-01-01', 'Agent chunk ${j}', 'Agent content ${j}', 'Agent content ${j}', ${j})`
      )
    );
  }
  stmts.push(
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'llms-chunk-2025-01-01', 'LLMs chunk', 'LLMs content', 'LLMs content', 5)`
    )
  );

  // Episodes 2-10: 1 chunk with "agent", 1 chunk with "llms" each
  for (let i = 2; i <= 10; i++) {
    const day = String(i).padStart(2, "0");
    stmts.push(
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (${i}, 'agent-chunk-${i}-2025-01-${day}', 'Agent note ${i}', 'Agent note ${i}', 'Agent note ${i}', 0)`
      )
    );
    stmts.push(
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (${i}, 'llms-chunk-${i}-2025-01-${day}', 'LLMs note ${i}', 'LLMs note ${i}', 'LLMs note ${i}', 1)`
      )
    );
  }

  // Episode 1 also gets 2 "rare" chunks (but rare has usage_count=3 < 5, so excluded)
  stmts.push(
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'rare-chunk-0-2025-01-01', 'Rare chunk 0', 'Rare content', 'Rare content', 6)`
    )
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'rare-chunk-1-2025-01-01', 'Rare chunk 1', 'Rare content', 'Rare content', 7)`
    )
  );

  await env.DB.batch(stmts);

  // Now link chunk_topics
  const linkStmts: D1PreparedStatement[] = [];

  // Episode 1: chunks 1-5 → agent (topic 1), chunk 6 → llms (topic 2), chunks 7-8 → rare (topic 3)
  for (let j = 1; j <= 5; j++) {
    linkStmts.push(env.DB.prepare(`INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (${j}, 1)`));
  }
  linkStmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"));
  linkStmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 3)"));
  linkStmts.push(env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 3)"));

  // Episodes 2-10: agent chunks and llms chunks
  // chunk IDs: ep1 has chunks 1-8, ep2 starts at 9
  // ep2: chunk 9 (agent), chunk 10 (llms)
  // ep3: chunk 11 (agent), chunk 12 (llms)
  // ...
  let chunkId = 9;
  for (let i = 2; i <= 10; i++) {
    linkStmts.push(env.DB.prepare(`INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (${chunkId}, 1)`)); // agent
    chunkId++;
    linkStmts.push(env.DB.prepare(`INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (${chunkId}, 2)`)); // llms
    chunkId++;
  }

  // episode_topics links
  linkStmts.push(env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 1)")); // agent
  linkStmts.push(env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 2)")); // llms
  linkStmts.push(env.DB.prepare("INSERT INTO episode_topics (episode_id, topic_id) VALUES (1, 3)")); // rare
  for (let i = 2; i <= 10; i++) {
    linkStmts.push(env.DB.prepare(`INSERT INTO episode_topics (episode_id, topic_id) VALUES (${i}, 1)`));
    linkStmts.push(env.DB.prepare(`INSERT INTO episode_topics (episode_id, topic_id) VALUES (${i}, 2)`));
  }

  await env.DB.batch(linkStmts);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedTrendingData();
});

describe("Trending topics on episode page", () => {
  it("shows trending-topics section when a topic spikes", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2025-01-01-ep");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("trending-topics");
  });

  it("shows spike ratio formatted as +N.Nx", async () => {
    const res = await SELF.fetch("http://localhost/episodes/2025-01-01-ep");
    const html = await res.text();
    expect(res.status).toBe(200);
    // agent spikes significantly in this episode vs corpus average
    // Format: (+N.N×) where N.N > 2.0
    expect(html).toMatch(/\(\+\d+\.\d+\u00d7\)/); // matches (+N.N×) pattern
    expect(html).toContain("trending-ratio");
  });

  it("does NOT show trending section when no topic spikes", async () => {
    // Episode 2 has 1 agent chunk (avg is 1) and 1 llms chunk (avg is 1) -- no spike
    const res = await SELF.fetch("http://localhost/episodes/2025-01-02-ep");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("trending-topics");
  });

  it("excludes topics with low usage_count from trending", async () => {
    // "rare" has usage_count=3 (<5) so even with 2 chunks in ep1, it should not appear
    const res = await SELF.fetch("http://localhost/episodes/2025-01-01-ep");
    const html = await res.text();
    expect(res.status).toBe(200);
    // trending section should show agent but not rare
    expect(html).toContain("agent");
    const trendingStart = html.indexOf("trending-topics");
    const trendingEnd = html.indexOf("</div>", trendingStart + 100);
    const trendingSection = html.substring(trendingStart, trendingEnd);
    expect(trendingSection).not.toContain("rare");
  });
});

describe("Trending topics on chunk page", () => {
  it("shows trending from parent episode on chunk page", async () => {
    // Chunk from episode 1 (the spike episode) should show trending
    const res = await SELF.fetch("http://localhost/chunks/agent-chunk-0-2025-01-01");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("trending-topics");
    expect(html).toMatch(/\(\+\d+\.\d+\u00d7\)/); // matches (+N.N×) pattern
  });
});

/**
 * End-to-end pipeline tests: text -> enrichment -> rendered page.
 * Validates that enrichment results are visible on HTTP responses.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { enrichChunks, finalizeEnrichment } from "./ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('test', 'Test')"),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-01-06-test', 'Bits and Bobs 1/6/25', '2025-01-06', 2025, 1, 6, 2, 'notes')"
    ),
  ]);
});

describe("End-to-end: text -> enrichment -> rendered page", () => {
  it("OpenAI mention becomes an entity topic visible on chunk page", async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'openai-mention-2025-01-06-test-0', 'OpenAI changes everything',
         'OpenAI released GPT-5 and it changes the landscape of AI development significantly.',
         'OpenAI released GPT-5 and it changes the landscape of AI development significantly.', 0)`
    ).run();
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'filler-chunk-2025-01-06-test-1', 'Filler chunk',
         'This is a secondary chunk with different content about platform dynamics.',
         'This is a secondary chunk with different content about platform dynamics.', 1)`
    ).run();

    await enrichChunks(env.DB, 100);
    await finalizeEnrichment(env.DB);

    // Verify: topic exists with kind='entity' in the DB
    const topic = await env.DB.prepare(
      "SELECT kind FROM topics WHERE slug = 'openai'"
    ).first<{ kind: string }>();
    expect(topic).not.toBeNull();
    expect(topic!.kind).toBe("entity");

    // Verify: chunk page renders and includes the topic link
    const chunkRes = await SELF.fetch(
      "http://localhost/chunks/openai-mention-2025-01-06-test-0"
    );
    expect(chunkRes.status).toBe(200);
    const html = await chunkRes.text();

    // OpenAI should appear in topics marginalia with link to /topics/openai
    expect(html).toContain('href="/topics/openai"');
    expect(html).toContain("topics-margin");
  });

  it("noise words in chunk text do not appear as topics on the page", async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'noise-test-2025-01-06-test-0', 'System and software discussion',
         'The system software model involves data and code products that tools enable.',
         'The system software model involves data and code products that tools enable.', 0)`
    ).run();
    // Need a second chunk for the episode
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'filler-2-2025-01-06-test-1', 'Filler',
         'Another chunk about ecosystem dynamics and platform evolution.',
         'Another chunk about ecosystem dynamics and platform evolution.', 1)`
    ).run();

    await enrichChunks(env.DB, 100);
    await finalizeEnrichment(env.DB);

    // Fetch the chunk page
    const chunkRes = await SELF.fetch(
      "http://localhost/chunks/noise-test-2025-01-06-test-0"
    );
    expect(chunkRes.status).toBe(200);
    const html = await chunkRes.text();

    // None of the noise words should appear as topic links
    expect(html).not.toContain('href="/topics/system"');
    expect(html).not.toContain('href="/topics/software"');
    expect(html).not.toContain('href="/topics/model"');
    expect(html).not.toContain('href="/topics/data"');
    expect(html).not.toContain('href="/topics/code"');
  });

  it("episode page shows topics from enriched chunks", async () => {
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'ep-topic-2025-01-06-test-0', 'Anthropic builds Claude',
         'Anthropic continues to develop Claude as a leading large language model assistant.',
         'Anthropic continues to develop Claude as a leading large language model assistant.', 0)`
    ).run();
    await env.DB.prepare(
      `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
       VALUES (1, 'ep-filler-2025-01-06-test-1', 'Filler',
         'Platform dynamics and ecosystem evolution in technology markets continue.',
         'Platform dynamics and ecosystem evolution in technology markets continue.', 1)`
    ).run();

    await enrichChunks(env.DB, 100);
    await finalizeEnrichment(env.DB);

    // Fetch the episode page
    const epRes = await SELF.fetch("http://localhost/episodes/2025-01-06-test");
    expect(epRes.status).toBe(200);
    const html = await epRes.text();

    // Anthropic should appear as a topic on the episode page
    expect(html).toContain('href="/topics/anthropic"');
  });
});

describe("Pipeline data integrity", () => {
  it("all chunk_topics reference valid chunks and topics after full pipeline", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'integrity-1-2025-01-06-test-0', 'Integrity Test 1',
           'OpenAI and Anthropic are leading the development of large language models.',
           'OpenAI and Anthropic are leading the development of large language models.', 0)`
      ),
      env.DB.prepare(
        `INSERT INTO chunks (episode_id, slug, title, content, content_plain, position)
         VALUES (1, 'integrity-2-2025-01-06-test-1', 'Integrity Test 2',
           'The ecosystem of machine learning frameworks continues to evolve rapidly.',
           'The ecosystem of machine learning frameworks continues to evolve rapidly.', 1)`
      ),
    ]);

    await enrichChunks(env.DB, 100);
    await finalizeEnrichment(env.DB);

    // No orphan chunk_topics
    const invalidChunkRefs = await env.DB.prepare(
      `SELECT ct.chunk_id FROM chunk_topics ct
       LEFT JOIN chunks c ON ct.chunk_id = c.id
       WHERE c.id IS NULL`
    ).all();
    expect(invalidChunkRefs.results).toHaveLength(0);

    const invalidTopicRefs = await env.DB.prepare(
      `SELECT ct.topic_id FROM chunk_topics ct
       LEFT JOIN topics t ON ct.topic_id = t.id
       WHERE t.id IS NULL`
    ).all();
    expect(invalidTopicRefs.results).toHaveLength(0);

    // usage_count matches actual chunk_topics count
    const mismatches = await env.DB.prepare(
      `SELECT t.id, t.usage_count as declared,
              (SELECT COUNT(*) FROM chunk_topics ct WHERE ct.topic_id = t.id) as actual
       FROM topics t
       WHERE t.usage_count != (SELECT COUNT(*) FROM chunk_topics ct WHERE ct.topic_id = t.id)
         AND t.usage_count > 0`
    ).all();
    expect(mismatches.results).toHaveLength(0);
  });
});

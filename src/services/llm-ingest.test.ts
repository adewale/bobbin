import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import {
  buildEpisodeLlmMessages,
  enrichEpisodeIdsWithLlm,
  loadLlmBoostsForChunks,
  parseEpisodeLlmResponse,
  persistEpisodeLlmCandidates,
} from "./llm-ingest";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('doc', 'Doc')"),
    env.DB.prepare("INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-01-06-doc', 'Bits and Bobs 1/6/25', '2025-01-06', 2025, 1, 6, 2, 'notes')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-a', 'A', 'Prompt injection attack matters.', 'Prompt injection attack matters.', 0)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (1, 'chunk-b', 'B', 'Claude Code is useful.', 'Claude Code is useful.', 1)"),
  ]);
});

describe("llm ingest contract", () => {
  it("builds an episode-level prompt with chunk slugs and normalized text", () => {
    const messages = buildEpisodeLlmMessages({
      episodeId: 1,
      episodeSlug: "2025-01-06-doc",
      title: "Bits and Bobs 1/6/25",
      normalizedText: "prompt injection attack matters claude code is useful",
      chunks: [
        { slug: "chunk-a", title: "A", contentPlain: "Prompt injection attack matters.", linkCount: 1, imageCount: 0, maxDepth: 2, formattingHints: ["underline", "nested_list"] },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("chunk-a");
    expect(messages[1].content).toContain("normalized_episode_text");
    expect(messages[1].content).toContain("link_count");
    expect(messages[1].content).toContain("formatting_hints");
  });

  it("parses valid LLM JSON and rejects unsupported evidence", () => {
    const parsed = parseEpisodeLlmResponse(JSON.stringify({
      candidates: [
        {
          name: "Prompt injection attack",
          kind: "phrase",
          confidence: 0.9,
          rank_position: 0,
          aliases: ["prompt injection"],
          evidence: [
            { chunk_slug: "chunk-a", quote: "Prompt injection attack" },
            { chunk_slug: "missing", quote: "bad" },
          ],
        },
      ],
    }), [
      { slug: "chunk-a", title: "A", contentPlain: "Prompt injection attack matters." },
      { slug: "chunk-b", title: "B", contentPlain: "Claude Code is useful." },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].slug).toBe("prompt-injection-attack");
    expect(parsed[0].evidence).toEqual([{ chunkSlug: "chunk-a", quote: "Prompt injection attack" }]);
  });

  it("persists episode candidates and exposes chunk-level boost maps", async () => {
    await persistEpisodeLlmCandidates(env.DB, 1, 1, "{}", [
      {
        name: "Prompt injection attack",
        slug: "prompt-injection-attack",
        kind: "phrase",
        confidence: 0.95,
        rankPosition: 0,
        aliases: ["prompt injection"],
        evidence: [{ chunkSlug: "chunk-a", quote: "Prompt injection attack" }],
      },
    ], new Map([["chunk-a", 1], ["chunk-b", 2]]));

    const boosts = await loadLlmBoostsForChunks(env.DB, [1, 2]);
    expect(boosts.get(1)?.get("prompt-injection-attack")).toEqual({
      confidence: 0.95,
      kind: "phrase",
      candidateName: "Prompt injection attack",
    });
    expect(boosts.get(2)).toBeUndefined();

    const replacement = [{
      name: "Claude Code", slug: "claude-code", kind: "entity" as const,
      confidence: 0.9, rankPosition: 0, aliases: [],
      evidence: [{ chunkSlug: "chunk-b", quote: "Claude Code" }],
    }];
    // A bad evidence FK must roll back the whole replacement, including the
    // cascading delete of the previously published run.
    await expect(persistEpisodeLlmCandidates(env.DB, 1, 1, "replacement", replacement,
      new Map([["chunk-b", 9999]]))).rejects.toThrow();
    expect((await loadLlmBoostsForChunks(env.DB, [1])).get(1)?.get("prompt-injection-attack")).toEqual({
      confidence: 0.95, kind: "phrase", candidateName: "Prompt injection attack",
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await persistEpisodeLlmCandidates(env.DB, 1, 1, "replacement", replacement, new Map([["chunk-b", 2]]));
    }
    expect(await env.DB.prepare("SELECT raw_response_json FROM llm_enrichment_runs WHERE episode_id = 1").all())
      .toMatchObject({ results: [{ raw_response_json: "replacement" }] });
    expect(await env.DB.prepare("SELECT candidate_name FROM llm_episode_candidates WHERE episode_id = 1").all())
      .toMatchObject({ results: [{ candidate_name: "Claude Code" }] });
    expect(await env.DB.prepare("SELECT chunk_id, quote FROM llm_episode_candidate_evidence").all())
      .toMatchObject({ results: [{ chunk_id: 2, quote: "Claude Code" }] });
  });

  it("loads episode/chunk rows and enriches existing episodes by id", async () => {
    const calls: any[] = [];
    const fakeEnv = {
      ...env,
      AI: {
        run: async (_model: string, payload: any) => {
          calls.push(payload);
          const parsed = JSON.parse(payload.messages[1].content);
          return {
            response: JSON.stringify({
              candidates: [
                {
                  name: "Prompt injection attack",
                  kind: "phrase",
                  confidence: 0.9,
                  rank_position: 0,
                  aliases: ["prompt injection"],
                  evidence: [{ chunk_slug: parsed.chunks[0].slug, quote: "Prompt injection attack" }],
                },
              ],
            }),
          };
        },
      },
    };

    const processed = await enrichEpisodeIdsWithLlm(fakeEnv as any, [1]);
    expect(processed).toBe(1);
    expect(calls).toHaveLength(1);

    const runCount = await env.DB.prepare("SELECT COUNT(*) as c FROM llm_enrichment_runs").first<{ c: number }>();
    expect(runCount?.c).toBe(1);
  });
});

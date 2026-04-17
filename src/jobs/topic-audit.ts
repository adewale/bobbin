import { enrichAllChunks, finalizeEnrichment } from "./ingest";
import type { TopicExtractorMode } from "../services/yake-runtime";

interface AuditChunk {
  slug: string;
  title: string;
  content: string;
  expectedSlugs: string[];
}

interface AuditEpisode {
  slug: string;
  title: string;
  publishedDate: string;
  chunks: AuditChunk[];
}

const AUDIT_EPISODES: AuditEpisode[] = [
  {
    slug: "2025-01-06",
    title: "Audit Ep 1",
    publishedDate: "2025-01-06",
    chunks: [
      {
        slug: "audit-1",
        title: "Audit 1",
        content: "Claude Code helps teams work with llms, but prompt injection attack remains a real security issue.",
        expectedSlugs: ["claude", "claude-code", "llms", "prompt-injection-attack"],
      },
      {
        slug: "audit-2",
        title: "Audit 2",
        content: "Claude Code keeps improving llms workflows while prompt injection attack becomes easier to explain.",
        expectedSlugs: ["claude", "claude-code", "llms", "prompt-injection-attack"],
      },
    ],
  },
  {
    slug: "2025-01-13",
    title: "Audit Ep 2",
    publishedDate: "2025-01-13",
    chunks: [
      {
        slug: "audit-3",
        title: "Audit 3",
        content: "OpenAI and Claude Code both make llms more useful, but prompt injection attack is still a real risk.",
        expectedSlugs: ["openai", "claude-code", "llms", "prompt-injection-attack"],
      },
      {
        slug: "audit-4",
        title: "Audit 4",
        content: "Teams using Claude Code on top of llms still need to defend against prompt injection attack.",
        expectedSlugs: ["claude-code", "llms", "prompt-injection-attack"],
      },
    ],
  },
  {
    slug: "2025-01-20",
    title: "Audit Ep 3",
    publishedDate: "2025-01-20",
    chunks: [
      {
        slug: "audit-5",
        title: "Audit 5",
        content: "Vibe coding and infinite software are changing how teams think about tools and production workflows.",
        expectedSlugs: ["vibe-coding", "infinite-software"],
      },
      {
        slug: "audit-6",
        title: "Audit 6",
        content: "People treat vibe coding as a gateway into infinite software and more adaptive systems.",
        expectedSlugs: ["vibe-coding", "infinite-software"],
      },
    ],
  },
  {
    slug: "2025-01-27",
    title: "Audit Ep 4",
    publishedDate: "2025-01-27",
    chunks: [
      {
        slug: "audit-7",
        title: "Audit 7",
        content: "Infinite software makes vibe coding more legible because the software keeps adapting to the user.",
        expectedSlugs: ["infinite-software", "vibe-coding"],
      },
      {
        slug: "audit-8",
        title: "Audit 8",
        content: "Good examples of vibe coding usually point toward infinite software rather than one-off demos.",
        expectedSlugs: ["vibe-coding", "infinite-software"],
      },
    ],
  },
  {
    slug: "2025-02-03",
    title: "Audit Ep 5",
    publishedDate: "2025-02-03",
    chunks: [
      {
        slug: "audit-9",
        title: "Audit 9",
        content: "Disconfirming evidence is essential when Goodhart law starts to distort a business model.",
        expectedSlugs: ["disconfirming-evidence", "goodhart-law", "business-model"],
      },
      {
        slug: "audit-10",
        title: "Audit 10",
        content: "A business model gets weaker when Goodhart law hides the disconfirming evidence you most need.",
        expectedSlugs: ["business-model", "goodhart-law", "disconfirming-evidence"],
      },
    ],
  },
  {
    slug: "2025-02-10",
    title: "Audit Ep 6",
    publishedDate: "2025-02-10",
    chunks: [
      {
        slug: "audit-11",
        title: "Audit 11",
        content: "Goodhart law and disconfirming evidence both matter when your business model depends on the wrong proxy.",
        expectedSlugs: ["goodhart-law", "disconfirming-evidence", "business-model"],
      },
      {
        slug: "audit-12",
        title: "Audit 12",
        content: "When leaders ignore disconfirming evidence, Goodhart law eventually corrupts the business model.",
        expectedSlugs: ["disconfirming-evidence", "goodhart-law", "business-model"],
      },
    ],
  },
];

export interface TopicAuditMetrics {
  extractorMode: TopicExtractorMode;
  precisionAt5: number;
  recallAt5: number;
  precisionAt10: number;
  recallAt10: number;
  totalExpected: number;
  totalPredictedAt5: number;
  totalPredictedAt10: number;
  totalHitsAt5: number;
  totalHitsAt10: number;
}

export async function runTopicAuditBenchmark(db: D1Database, extractorMode: TopicExtractorMode): Promise<TopicAuditMetrics> {
  await db.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('audit-source', 'Audit Source')").run();
  let episodeId = 1;
  let chunkPosition = 0;

  for (const episode of AUDIT_EPISODES) {
    await db.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, ?, ?, ?, 2025, 1, 1, ?, 'notes')"
    ).bind(episode.slug, episode.title, episode.publishedDate, episode.chunks.length).run();

    for (const chunk of episode.chunks) {
      await db.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(episodeId, chunk.slug, chunk.title, chunk.content, chunk.content, chunkPosition).run();
      chunkPosition += 1;
    }

    episodeId += 1;
  }

  await enrichAllChunks(db, 200, 120000, undefined, extractorMode);
  await finalizeEnrichment(db);

  let totalExpected = 0;
  let totalPredictedAt5 = 0;
  let totalPredictedAt10 = 0;
  let totalHitsAt5 = 0;
  let totalHitsAt10 = 0;

  for (const episode of AUDIT_EPISODES) {
    for (const chunk of episode.chunks) {
      const predicted = await db.prepare(
        `SELECT t.slug
         FROM chunk_topics ct
         JOIN chunks c ON c.id = ct.chunk_id
         JOIN topics t ON t.id = ct.topic_id
         WHERE c.slug = ?
         ORDER BY t.usage_count DESC, t.distinctiveness DESC, t.slug ASC`
      ).bind(chunk.slug).all<{ slug: string }>();

      const top5 = predicted.results.slice(0, 5).map((row) => row.slug);
      const top10 = predicted.results.slice(0, 10).map((row) => row.slug);
      const expected = new Set(chunk.expectedSlugs);

      totalExpected += expected.size;
      totalPredictedAt5 += top5.length;
      totalPredictedAt10 += top10.length;
      totalHitsAt5 += top5.filter((slug) => expected.has(slug)).length;
      totalHitsAt10 += top10.filter((slug) => expected.has(slug)).length;
    }
  }

  return {
    extractorMode,
    precisionAt5: totalPredictedAt5 === 0 ? 0 : totalHitsAt5 / totalPredictedAt5,
    recallAt5: totalExpected === 0 ? 0 : totalHitsAt5 / totalExpected,
    precisionAt10: totalPredictedAt10 === 0 ? 0 : totalHitsAt10 / totalPredictedAt10,
    recallAt10: totalExpected === 0 ? 0 : totalHitsAt10 / totalExpected,
    totalExpected,
    totalPredictedAt5,
    totalPredictedAt10,
    totalHitsAt5,
    totalHitsAt10,
  };
}

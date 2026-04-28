import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { SELF, env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { buildPeriodSummary } from "../lib/period-summary";

async function seedSummaryData() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sources (google_doc_id, title) VALUES ('summary-doc', 'Summary Source')"),

    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-02-05-s', 'Bits and Bobs 2/5/24', '2024-02-05', 2024, 2, 5, 1, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2024-04-08-s', 'Bits and Bobs 4/8/24', '2024-04-08', 2024, 4, 8, 1, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-01-13-s', 'Bits and Bobs 1/13/25', '2025-01-13', 2025, 1, 13, 1, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-03-03-s', 'Bits and Bobs 3/3/25', '2025-03-03', 2025, 3, 3, 2, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-04-07-s', 'Bits and Bobs 4/7/25', '2025-04-07', 2025, 4, 7, 2, 'notes')"
    ),
    env.DB.prepare(
      "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, '2025-04-21-s', 'Bits and Bobs 4/21/25', '2025-04-21', 2025, 4, 21, 2, 'notes')"
    ),
  ]);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (1, 'quiet-feb-2024', 'Quiet February', 'No linked topics here.', 'No linked topics here.', 0, 1)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (2, 'calendar-2024', 'Calendar drift', 'Calendar drift.', 'Calendar drift.', 0, 3)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (3, 'ongoing-2025-01', 'Ongoing in January', 'Ongoing in January.', 'Ongoing in January.', 0, 4)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (4, 'legacy-2025-03', 'Legacy systems linger', 'Legacy systems linger.', 'Legacy systems linger.', 0, 5)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (4, 'ongoing-2025-03', 'Ongoing in March', 'Ongoing in March.', 'Ongoing in March.', 1, 6)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach, links_json) VALUES (5, 'agents-2025-04', 'Agents start to cohere', 'Agents start to cohere.', 'Agents start to cohere.', 0, 10, '[{\"href\":\"https://example.com/agents\",\"text\":\"Example Agents\"}]')"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (5, 'ongoing-2025-04-a', 'Ongoing in April A', 'Ongoing in April A.', 'Ongoing in April A.', 1, 8)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (6, 'agents-2025-04-b', 'Agent operations broaden', 'Agent operations broaden.', 'Agent operations broaden.', 0, 9)"),
    env.DB.prepare("INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (6, 'codex-2025-04', 'Codex enters the archive', 'Codex enters the archive.', 'Codex enters the archive.', 1, 7)"),
  ]);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('agent', 'agent', 5, 8.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('ongoing', 'ongoing', 6, 3.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('legacy', 'legacy', 5, 5.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('calendar', 'calendar', 5, 4.0)"),
    env.DB.prepare("INSERT INTO topics (name, slug, usage_count, distinctiveness) VALUES ('codex', 'codex', 5, 12.0)"),
  ]);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (2, 4)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (3, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, 3)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (5, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (6, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (7, 2)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (8, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (9, 1)"),
    env.DB.prepare("INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (9, 5)"),
  ]);
}

beforeEach(async () => {
  await applyTestMigrations(env.DB);
  await seedSummaryData();
});

function topicSummaryItems(html: string) {
  const section = html.split('class="topic-summary body-panel"')[1] ?? "";
  const list = section.split('<ul class="topic-summary-list">')[1]?.split("</ul>")[0] ?? "";
  return [...list.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);
}

function panelFragment(html: string, heading: string) {
  return html.split(`>${heading}<`)[1]?.split("</section>")[0] ?? "";
}

function subsectionFragment(html: string, heading: string) {
  return html.split(`<h3>${heading}</h3>`)[1]?.split("</div>")[0] ?? "";
}

function indexOfOrThrow(html: string, needle: string) {
  const index = html.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function yearSection(html: string, year: string) {
  return html.split(`<h2><a href="/summaries/${year}">${year}</a></h2>`)[1]?.split("</section>")[0] ?? "";
}

function rowFragment(html: string, href: string) {
  return html.split(`href="${href}"`)[1]?.split("</li>")[0] ?? "";
}

describe("GET /summaries", () => {
  it("lists only years and months that have episodes", async () => {
    const res = await SELF.fetch("http://localhost/summaries");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('href="/summaries/2025"');
    expect(html).toContain('href="/summaries/2025/4"');
    expect(html).toContain('href="/summaries/2025/3"');
    expect(html).toContain('href="/summaries/2024"');
    expect(html).toContain('href="/summaries/2024/2"');
    expect(html).not.toContain('href="/summaries/2025/2"');

    const aprilRow = rowFragment(html, "/summaries/2025/4");
    expect(aprilRow).toContain(">April 2025<");
    expect(aprilRow).toContain(">2 episodes, 4 chunks<");
  });

  it("uses canonical published-date periods and actual chunk rows for index links and counts", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, 'drifted-index-s', 'Drifted index episode', '2026-06-02', 2030, 12, 2, 99, 'notes')"
      ),
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (7, 'drifted-index-chunk-s', 'Drifted index chunk', 'Only one real chunk.', 'Only one real chunk.', 0, 1)"
      ),
    ]);

    const res = await SELF.fetch("http://localhost/summaries");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('href="/summaries/2026"');
    expect(html).toContain('href="/summaries/2026/6"');
    expect(html).not.toContain('href="/summaries/2030"');
    expect(html).not.toContain('href="/summaries/2030/12"');
    expect(html).not.toContain("99 chunks");
  });

  it("uses the year heading as the only year link and orders months from January to December", async () => {
    const res = await SELF.fetch("http://localhost/summaries");
    expect(res.status).toBe(200);

    const html = await res.text();
    const section2025 = yearSection(html, "2025");
    expect(section2025).not.toContain('class="list-row-title">2025<');

    const january = indexOfOrThrow(html, ">January 2025<");
    const march = indexOfOrThrow(html, ">March 2025<");
    const april = indexOfOrThrow(html, ">April 2025<");
    expect(january).toBeLessThan(march);
    expect(march).toBeLessThan(april);
  });

  it("adds three topic-card-style year metrics for chunk volume, new topics, and spikiest months", async () => {
    const res = await SELF.fetch("http://localhost/summaries");
    expect(res.status).toBe(200);

    const html = await res.text();
    const section2025 = yearSection(html, "2025");

    expect(section2025).toContain('class="topic-multiples summary-year-cards"');
    expect((section2025.match(/class="multiple-cell"/g) ?? []).length).toBe(3);
    expect(section2025).toContain(">Chunk volume<");
    expect(section2025).toContain(">New topics<");
    expect(section2025).toContain(">Spikiest months<");
    expect(section2025).toContain(">7<");
    expect(section2025).toContain(">4<");
    expect((section2025.match(/class="multiple-spark rail-sparkline"/g) ?? []).length).toBe(3);
  });
});

describe("GET /summaries/:year/:month", () => {
  it("renders the monthly summary using existing body and rail primitives", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025/4");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("April 2025");
    expect(html).toContain('href="/summaries"');
    expect(html).toContain('href="/summaries/2025"');
    expect(html).toContain('class="topic-summary body-panel"');
    expect(html).toContain('class="body-panel body-panel-list"');
    expect(html).toContain('class="page-rail');
    expect(html).toContain('class="rail-panel-heading-row"');
    expect(html).not.toContain('class="period-summary"');
    expect(html).not.toContain('class="summary-panel"');
  });

  it("renders exactly the buildPeriodSummary output for the period facts", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025/4");
    const html = await res.text();

    const expected = buildPeriodSummary({
      periodLabel: "April 2025",
      episodeCount: 2,
      chunkCount: 4,
      firstPublishedDate: "2025-04-07",
      lastPublishedDate: "2025-04-21",
      topByMentions: { name: "agent", chunkCount: 4 },
      newTopicCount: 2,
      topNewTopic: { name: "agent", chunkCount: 4 },
      intensifiedCount: 3,
      downshiftedCount: 1,
      topContrast: { name: "agent", spikeRatio: 2.4 },
    });

    const items = topicSummaryItems(html);
    expect(items).toEqual(expected);
    expect(html).toContain("Representative Chunks");
    expect(html).toContain("Episode Timeline");
  });

  it("treats movers as a comparison to the previous month", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025/4");
    const html = await res.text();

    expect(html).toContain("Movers");
    expect(html).toContain('href="/topics/agent"');
    expect(html).toContain('href="/topics/legacy"');
    expect(html).toContain('aria-label="trending up"');
    expect(html).toContain('aria-label="trending down"');
    expect(html).toContain(">4<");
    expect(html).toContain(">1<");
  });

  it("treats new topics as new to the corpus, not merely new vs the previous month", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025/4");
    const html = await res.text();
    const newTopicsPanel = panelFragment(html, "New Topics");

    expect(html).toContain("New Topics");
    expect(newTopicsPanel).toContain('href="/topics/agent"');
    expect(newTopicsPanel).toContain('href="/topics/codex"');
    expect(newTopicsPanel).not.toContain('href="/topics/ongoing"');
    expect(newTopicsPanel).not.toContain('href="/topics/legacy"');
  });

  it("does not render the External Links panel on monthly summaries even when chunks contain links", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025/4");
    const html = await res.text();

    expect(html).not.toContain(">External Links<");
    expect(html).not.toContain("summary-accordion--rail");
  });

  it("uses uncapped totals in the summary panel even when display panels stay capped", async () => {
    const newTopicStatements = [];
    const declineStatements = [];

    for (let index = 0; index < 7; index += 1) {
      const topicId = 6 + index;
      newTopicStatements.push(
        env.DB.prepare(
          `INSERT INTO topics (id, name, slug, usage_count, distinctiveness) VALUES (?, ?, ?, 1, 2.0)`
        ).bind(topicId, `new-topic-${index}`, `new-topic-${index}`),
      );
      newTopicStatements.push(
        env.DB.prepare(
          `INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (?, ?)`
        ).bind(6 + (index % 4), topicId),
      );
    }

    for (let index = 0; index < 5; index += 1) {
      const topicId = 13 + index;
      declineStatements.push(
        env.DB.prepare(
          `INSERT INTO topics (id, name, slug, usage_count, distinctiveness) VALUES (?, ?, ?, 1, 2.0)`
        ).bind(topicId, `march-only-${index}`, `march-only-${index}`),
      );
      declineStatements.push(
        env.DB.prepare(
          `INSERT INTO chunk_topics (chunk_id, topic_id) VALUES (4, ?)`
        ).bind(topicId),
      );
    }

    await env.DB.batch([...newTopicStatements, ...declineStatements]);

    const res = await SELF.fetch("http://localhost/summaries/2025/4");
    expect(res.status).toBe(200);

    const html = await res.text();
    const items = topicSummaryItems(html);
    expect(items).toContain(
      "9 topics first appear in this period; the most-mentioned is agent (4 chunks)."
    );
    expect(items).toContain("10 topics intensified vs the previous period; 6 declined.");

    const moversPanel = panelFragment(html, "Movers");
    const newTopicsPanel = panelFragment(html, "New Topics");
    expect((moversPanel.match(/<li>/g) ?? []).length).toBe(10);
    expect((newTopicsPanel.match(/<li>/g) ?? []).length).toBe(8);
  });

  it("404s a period with zero episodes", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025/2");
    expect(res.status).toBe(404);
  });

  it("404s malformed periods", async () => {
    const badYear = await SELF.fetch("http://localhost/summaries/nope");
    const badMonth = await SELF.fetch("http://localhost/summaries/2025/13");
    expect(badYear.status).toBe(404);
    expect(badMonth.status).toBe(404);
  });

  it("property: malformed summary segments always 404 instead of rendering or crashing", async () => {
    const invalidYear = fc.array(fc.constantFrom("a", "+", " ", "x", "e", "_"), {
      minLength: 1,
      maxLength: 8,
    }).map((chars) => chars.join("")).filter((value) => !/^\d{4}$/.test(value));

    const invalidMonth = fc.array(fc.constantFrom("a", "+", " ", "0", "x", "e", "_"), {
      minLength: 1,
      maxLength: 4,
    }).map((chars) => chars.join("")).filter((value) => !/^(0?[1-9]|1[0-2])$/.test(value));

    await fc.assert(
      fc.asyncProperty(invalidYear, async (year) => {
        const res = await SELF.fetch(`http://localhost/summaries/${encodeURIComponent(year)}`);
        expect(res.status).toBe(404);
      }),
      { numRuns: 30 }
    );

    await fc.assert(
      fc.asyncProperty(invalidMonth, async (month) => {
        const res = await SELF.fetch(`http://localhost/summaries/2025/${encodeURIComponent(month)}`);
        expect(res.status).toBe(404);
      }),
      { numRuns: 30 }
    );
  });
});

describe("GET /summaries/:year", () => {
  it("renders the yearly summary and compares movers to the previous year", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain(">2025<");
    expect(html).toContain("January");
    expect(html).toContain("March");
    expect(html).toContain("April");
    expect(html).toContain('href="/topics/calendar"');
    expect(html).toContain('aria-label="trending down"');
  });

  it("renders month groups as closed accordions in chronological order", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect((html.match(/class="summary-accordion summary-accordion--body"/g) ?? []).length).toBe(3);
    expect(html).not.toContain('class="summary-accordion summary-accordion--body" open');

    const january = indexOfOrThrow(html, ">January<");
    const march = indexOfOrThrow(html, ">March<");
    const april = indexOfOrThrow(html, ">April<");
    expect(january).toBeLessThan(march);
    expect(march).toBeLessThan(april);
  });

  it("does not render the External Links panel on yearly summaries even when chunks contain links", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2025");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).not.toContain(">External Links<");
    expect(html).not.toContain("summary-accordion--rail");
  });

  it("groups yearly timeline rows by the publication month, not the denormalized month column", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO episodes (source_id, slug, title, published_date, year, month, day, chunk_count, format) VALUES (1, 'mismatched-month-s', 'Mismatched month episode', '2025-05-05', 2025, 4, 5, 1, 'notes')"
      ),
      env.DB.prepare(
        "INSERT INTO chunks (episode_id, slug, title, content, content_plain, position, reach) VALUES (7, 'mismatched-month-chunk-s', 'Mismatched month chunk', 'Chunk body.', 'Chunk body.', 0, 1)"
      ),
    ]);

    const res = await SELF.fetch("http://localhost/summaries/2025");
    expect(res.status).toBe(200);

    const html = await res.text();
    const maySection = subsectionFragment(html, "May");
    const aprilSection = subsectionFragment(html, "April");
    expect(html).toContain("May");
    expect(maySection).toContain("Mismatched month episode");
    expect(aprilSection).not.toContain("Mismatched month episode");
  });

  it("uses real chunk rows for yearly timeline counts even if episode.chunk_count drifts", async () => {
    await env.DB.prepare(
      "UPDATE episodes SET chunk_count = 99 WHERE slug = '2025-04-07-s'"
    ).run();

    const res = await SELF.fetch("http://localhost/summaries/2025");
    expect(res.status).toBe(200);

    const html = await res.text();
    const timeline = html.split(">Episode Timeline<")[1] ?? "";
    const aprilRow = rowFragment(timeline, "/episodes/2025-04-07-s");
    expect(aprilRow).toContain(">Bits and Bobs 4/7/25<");
    expect(aprilRow).toContain(">2 chunks<");
    expect(html).toContain(">2 episodes, 4 chunks<");
    expect(html).not.toContain(">99 chunks<");
  });

  it("omits the Movers panel when the previous comparable period has zero episodes", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2024/2");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).not.toContain(">Movers<");
  });

  it("omits each empty rail panel and the rail aside when all three remaining rail sources are empty", async () => {
    const res = await SELF.fetch("http://localhost/summaries/2024/2");
    const html = await res.text();

    expect(html).not.toContain(">New Topics<");
    expect(html).not.toContain(">Movers<");
    expect(html).not.toContain(">Archive Contrast<");
    expect(html).not.toContain(">External Links<");
    expect(html).not.toContain('class="page-rail');
  });
});

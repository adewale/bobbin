import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractCandidateDecisions, extractTopics, normalizeChunkText } from "./topic-extractor";
import { STOPWORDS } from "../lib/text";

describe("extractTopics properties", () => {
  it("non-entity topics never exceed maxTopics", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 500 }),
        fc.integer({ min: 1, max: 10 }),
        (text, maxTopics) => {
          const topics = extractTopics(text, maxTopics);
          // Entities are exempt from the limit (always included)
          const nonEntities = topics.filter(t => t.kind !== "entity");
          expect(nonEntities.length).toBeLessThanOrEqual(maxTopics);
        }
      )
    );
  });

  it("topic slugs always match /^[a-z0-9-]*$/", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const topics = extractTopics(text);
        for (const topic of topics) {
          expect(topic.slug).toMatch(/^[a-z0-9-]*$/);
        }
      })
    );
  });

  it("topic names never contain HTML entities", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        // Add HTML entities to the input
        const withEntities = text + " it&#39;s &amp; &lt;bold&gt; &quot;quoted&quot;";
        const topics = extractTopics(withEntities);
        for (const topic of topics) {
          expect(topic.name).not.toContain("&#");
          expect(topic.name).not.toContain("&amp;");
          expect(topic.name).not.toContain("&lt;");
          expect(topic.name).not.toContain("&gt;");
          expect(topic.name).not.toContain("&quot;");
        }
      })
    );
  });

  it("topic names are never stopwords", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const topics = extractTopics(text);
        for (const topic of topics) {
          // Single-word topics should not be stopwords
          if (!topic.name.includes(" ")) {
            expect(STOPWORDS.has(topic.name)).toBe(false);
          }
        }
      })
    );
  });

  it("is deterministic — same input always produces same output", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 300 }), (text) => {
        const first = extractTopics(text);
        const second = extractTopics(text);
        expect(first).toEqual(second);
      })
    );
  });

  it("topic names are always > 3 characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 500 }), (text) => {
        const topics = extractTopics(text);
        for (const topic of topics) {
          expect(topic.name.length).toBeGreaterThan(3);
        }
      })
    );
  });

  it("accepted candidate decisions never contain duplicate slugs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 20, maxLength: 500 }),
        fc.integer({ min: 1, max: 8 }),
        (text, maxTopics) => {
          const decisions = extractCandidateDecisions(normalizeChunkText(text), 1, maxTopics);
          const accepted = decisions.filter((candidate) => candidate.decision === "accepted");
          const acceptedSlugs = accepted.map((candidate) => candidate.slug);
          expect(new Set(acceptedSlugs).size).toBe(acceptedSlugs.length);

          const acceptedNonEntities = accepted.filter((candidate) => candidate.kind !== "entity");
          expect(acceptedNonEntities.length).toBeLessThanOrEqual(maxTopics);
        }
      )
    );
  });
});

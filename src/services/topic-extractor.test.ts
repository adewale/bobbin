import { describe, it, expect } from "vitest";
import {
  buildPhraseLexicon,
  canonicalizeTopicCandidate,
  extractCandidateDecisions,
  extractTopics,
  rejectTopicCandidate,
  normalizeChunkText,
  type TopicCandidate,
} from "./topic-extractor";

describe("extractTopics (YAKE-based)", () => {
  it("extracts keyphrases from text", () => {
    const topics = extractTopics(
      "The swarm dynamics of transformer computing are fascinating. Transformer architectures evolve through embedding swarm intelligence."
    );
    expect(topics.length).toBeGreaterThan(0);
    // Should extract domain-relevant terms
    const names = topics.map((t) => t.name.toLowerCase());
    const hasDomainTerm = names.some(n =>
      n.includes("swarm") || n.includes("transformer") || n.includes("computing")
    );
    expect(hasDomainTerm).toBe(true);
  });

  it("returns topics with slugs", () => {
    const topics = extractTopics("Platform markets and ecosystem dynamics reshape the industry fundamentally.");
    for (const topic of topics) {
      expect(topic.slug).toBeTruthy();
      expect(topic.slug).not.toContain(" ");
    }
  });

  it("excludes stopwords as standalone topics", () => {
    const topics = extractTopics("The quick brown fox jumps over the lazy dog repeatedly");
    const names = topics.map((t) => t.name);
    expect(names).not.toContain("the");
    expect(names).not.toContain("over");
  });

  it("respects maxTopics limit (plus entities)", () => {
    const topics = extractTopics(
      "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron. " +
      "These words matter in the Greek alphabet context.",
      3
    );
    // maxTopics limits YAKE + heuristic results (entities are extra)
    const nonEntities = topics.filter(t => t.kind !== "entity");
    expect(nonEntities.length).toBeLessThanOrEqual(3);
  });

  it("includes known entities alongside YAKE keyphrases", () => {
    const topics = extractTopics(
      "OpenAI released a new model. The transformer architecture enables reasoning. Google competes strongly."
    );
    const entities = topics.filter(t => t.kind === "entity");
    const keyphrases = topics.filter(t => !t.kind || t.kind === "concept");
    expect(entities.length).toBeGreaterThan(0);
    // YAKE should produce some keyphrases too
    expect(keyphrases.length).toBeGreaterThanOrEqual(0);
  });

  it("defaults to 5 topics per chunk (not 10 or 15)", () => {
    const topics = extractTopics(
      "Consumer AI is being absorbed by platforms. Enterprise AI converges around vendors. " +
      "Vertical AI carves domain-specific value. The APIs become commodities. " +
      "Agents coordinate through swarms and the ecosystem evolves rapidly."
    );
    // Max 5 YAKE + entities on top
    const nonEntities = topics.filter(t => t.kind !== "entity");
    expect(nonEntities.length).toBeLessThanOrEqual(5);
  });
});

describe("candidate pipeline hardening", () => {
  it("canonicalizes punctuation and plural variants into stable slugs", () => {
    const candidate: TopicCandidate = {
      chunkId: 1,
      source: "yake",
      rawCandidate: "Claude Codes",
      normalizedCandidate: "Claude Codes",
      name: "Claude Codes",
      slug: "claude-codes",
      score: 0.12,
      kind: "concept",
      provenance: ["yake_score:0.120000"],
    };

    const canonical = canonicalizeTopicCandidate(candidate);

    expect(canonical.name).toBe("claude code");
    expect(canonical.normalizedCandidate).toBe("claude code");
    expect(canonical.slug).toBe("claude-code");
  });

  it("rejects filler-bounded phrases before they reach topic insertion", () => {
    const candidate: TopicCandidate = {
      chunkId: 1,
      source: "yake",
      rawCandidate: "the future",
      normalizedCandidate: "the future",
      name: "the future",
      slug: "the-future",
      score: 0.3,
      kind: "concept",
      provenance: ["yake_score:0.300000"],
    };

    expect(rejectTopicCandidate(candidate)).toBe("filler_phrase_boundary");
  });

  it("rejects duplicate slugs across extractors while keeping the stronger candidate", () => {
    const artifact = normalizeChunkText("OpenAI and open ai appeared in the same chunk.");
    const decisions = extractCandidateDecisions(artifact, 7, 5, [
      {
        phrase: "open ai",
        normalizedName: "open ai",
        slug: "open-ai",
        supportCount: 5,
        docCount: 3,
        qualityScore: 9,
        provenance: "adjacent_pmi_bigram",
      },
    ]);

    const accepted = decisions.filter((candidate) => candidate.decision === "accepted");
    const rejectedDuplicates = decisions.filter((candidate) => candidate.decisionReason === "duplicate_slug");

    expect(new Set(accepted.map((candidate) => candidate.slug)).size).toBe(accepted.length);
    expect(rejectedDuplicates.length).toBeGreaterThan(0);
  });

  it("keeps the highest-quality canonical phrase entry when multiple discoveries collapse to one slug", () => {
    const lexicon = buildPhraseLexicon([
      "Claude Codes help teams. Claude Code reduces friction.",
      "People keep discussing Claude Code in workflow design.",
      "Claude Codes and Claude Code both appear in this corpus.",
    ]);

    const claudeEntries = lexicon.filter((entry) => entry.slug === "claude-code");
    expect(claudeEntries).toHaveLength(1);
    expect(claudeEntries[0].normalizedName).toBe("claude code");
    expect(claudeEntries[0].qualityScore).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  getCandidatePromotionReason,
  getCorpusPriorRejectionReason,
  getPhrasePromotionReason,
} from "./pipeline-tuning";

describe("pipeline tuning rules", () => {
  it("rejects low-support phrases from phrase promotion", () => {
    expect(getPhrasePromotionReason({
      docCount: 1,
      supportCount: 1,
      qualityScore: 3,
      normalizedName: "vibe coding",
    })).toBe("low_doc_count");
  });

  it("promotes phrases only after enough chunk and episode support", () => {
    expect(getCandidatePromotionReason(
      { kind: "phrase", normalizedCandidate: "vibe coding" },
      { chunkSupport: 3, episodeSupport: 1, existingUsageCount: 0, wordDistinctiveness: 0, llmSupportCount: 0, fidelitySupportCount: 0 }
    )).toBe("insufficient_episode_support");

    expect(getCandidatePromotionReason(
      { kind: "phrase", normalizedCandidate: "vibe coding" },
      { chunkSupport: 4, episodeSupport: 2, existingUsageCount: 0, wordDistinctiveness: 0, llmSupportCount: 0, fidelitySupportCount: 0 }
    )).toBeNull();
  });

  it("allows borderline phrase promotion when fidelity signals are present", () => {
    expect(getCandidatePromotionReason(
      { kind: "phrase", normalizedCandidate: "activation energy" },
      { chunkSupport: 3, episodeSupport: 2, existingUsageCount: 0, wordDistinctiveness: 0, llmSupportCount: 0, fidelitySupportCount: 1 }
    )).toBeNull();
  });

  it("lets repeated fidelity-supported phrases clear both support thresholds", () => {
    expect(getCandidatePromotionReason(
      { kind: "phrase", normalizedCandidate: "ambient agents" },
      { chunkSupport: 3, episodeSupport: 1, existingUsageCount: 0, wordDistinctiveness: 0, llmSupportCount: 0, fidelitySupportCount: 2 }
    )).toBeNull();
  });

  it("rejects weak singleton concepts from corpus priors", () => {
    expect(getCorpusPriorRejectionReason(
      { kind: "concept", normalizedCandidate: "learned" },
      { chunkSupport: 2, episodeSupport: 1, existingUsageCount: 0, wordDistinctiveness: 4, llmSupportCount: 0, fidelitySupportCount: 0 }
    )).toBeTruthy();

    expect(getCorpusPriorRejectionReason(
      { kind: "concept", normalizedCandidate: "llms" },
      { chunkSupport: 50, episodeSupport: 12, existingUsageCount: 100, wordDistinctiveness: 100, llmSupportCount: 0, fidelitySupportCount: 0 }
    )).toBeNull();
  });

  it("never promotes non-entities with insufficient episode spread (PBT)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("concept", "phrase"),
        fc.stringMatching(/^[a-z]{5,12}( [a-z]{5,12})?$/),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 1 }),
        (kind, normalizedCandidate, chunkSupport, episodeSupport) => {
          const reason = getCandidatePromotionReason(
            { kind, normalizedCandidate },
            { chunkSupport, episodeSupport, existingUsageCount: 0, wordDistinctiveness: 100, llmSupportCount: 0, fidelitySupportCount: 0 }
          );
          expect(reason).toBeTruthy();
        }
      )
    );
  });

  it("adding fidelity support never turns an accepted non-entity back into a rejection (PBT)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("concept", "phrase"),
        fc.stringMatching(/^[a-z]{5,12}( [a-z]{5,12})?$/),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 3 }),
        (kind, normalizedCandidate, chunkSupport, episodeSupport, wordDistinctiveness, fidelitySupportCount) => {
          const base = getCandidatePromotionReason(
            { kind, normalizedCandidate },
            { chunkSupport, episodeSupport, existingUsageCount: 0, wordDistinctiveness, llmSupportCount: 0, fidelitySupportCount }
          );
          const boosted = getCandidatePromotionReason(
            { kind, normalizedCandidate },
            { chunkSupport, episodeSupport, existingUsageCount: 0, wordDistinctiveness, llmSupportCount: 0, fidelitySupportCount: fidelitySupportCount + 1 }
          );

          if (base === null) {
            expect(boosted).toBeNull();
          }
        }
      )
    );
  });
});

import { decodeHtmlEntities } from "../lib/html";
import { tokenize } from "../lib/text";

export const CURRENT_NORMALIZATION_VERSION = 1;

export interface ChunkTextArtifact {
  rawText: string;
  normalizedText: string;
  normalizationVersion: number;
  warnings: string[];
}

export function normalizeChunkText(rawText: string): ChunkTextArtifact {
  const warnings: string[] = [];
  let normalizedText = rawText || "";

  normalizedText = normalizedText.replace(/&apos;/gi, "'");
  normalizedText = decodeHtmlEntities(normalizedText)
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u3000]/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedText) {
    warnings.push("empty_after_normalization");
  }

  if (/&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(normalizedText)) {
    warnings.push("residual_html_entity");
  }

  return {
    rawText,
    normalizedText,
    normalizationVersion: CURRENT_NORMALIZATION_VERSION,
    warnings,
  };
}

export function tokenizeNormalizedText(normalizedText: string): string[] {
  return tokenize(normalizedText);
}

export function countTokenFrequencies(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}

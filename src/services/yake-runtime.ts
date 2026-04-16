import { extractYakeKeywords as extractNaiveYakeKeywords } from "./yake";
import { extractYakeKeywords as extractYaketKeywords } from "@ade_oshineye/yaket/worker";

export type TopicExtractorMode = "naive" | "yaket";

export interface YakeKeywordResult {
  keyword: string;
  score: number;
}

export function normalizeTopicExtractorMode(mode?: string | null): TopicExtractorMode {
  return mode === "yaket" ? "yaket" : "naive";
}

export function extractRuntimeYakeKeywords(
  text: string,
  n: number = 5,
  maxNgram: number = 3,
  mode: TopicExtractorMode = "naive"
): YakeKeywordResult[] {
  if (mode === "yaket") {
    return extractYaketKeywords(text, n, maxNgram);
  }
  return extractNaiveYakeKeywords(text, n, maxNgram);
}

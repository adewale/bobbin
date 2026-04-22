import type { ChunkRow } from "../types";

export interface EpisodeExternalLink {
  href: string;
  label: string;
  chunkSlug: string;
  chunkTitle: string;
}

export function collectExternalLinks(chunks: ChunkRow[]) {
  const seen = new Set<string>();
  const links: EpisodeExternalLink[] = [];

  for (const chunk of chunks) {
    for (const link of extractChunkLinks(chunk)) {
      if (!isExternalHref(link.href)) continue;
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      links.push({
        href: link.href,
        label: link.label,
        chunkSlug: chunk.slug,
        chunkTitle: chunk.title,
      });
    }
  }

  return links;
}

function extractChunkLinks(chunk: ChunkRow) {
  const parsedLinks = parseLinksJson(chunk.links_json);
  if (parsedLinks.length > 0) return parsedLinks;

  const content = `${chunk.content}\n${chunk.content_plain}`;
  const urlMatches = content.match(/https?:\/\/\S+|www\.\S+/gi) ?? [];
  return urlMatches.map((href) => ({
    href,
    label: safeLabelFromHref(href),
  }));
}

function parseLinksJson(value: string | null) {
  if (!value) return [] as Array<{ href: string; label: string }>;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (typeof item === "string") {
          return { href: item, label: safeLabelFromHref(item) };
        }

        if (item && typeof item === "object" && typeof item.href === "string") {
          const label = typeof item.text === "string" && item.text.trim().length > 0
            ? item.text.trim()
            : safeLabelFromHref(item.href);
          return { href: item.href, label };
        }

        return null;
      })
      .filter((item): item is { href: string; label: string } => item !== null);
  } catch {
    return [];
  }
}

function isExternalHref(href: string) {
  return /^(https?:\/\/|www\.)/i.test(href.trim());
}

function safeLabelFromHref(href: string) {
  try {
    const url = new URL(href.startsWith("http") ? href : `https://${href}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

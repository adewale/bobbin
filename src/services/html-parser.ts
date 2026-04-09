import { parseEpisodeDate } from "../lib/date";
import type { ParsedEpisode, ParsedChunk } from "../types";

const DATE_PATTERN = /\d{1,2}\/\d{1,2}\/\d{2,4}/;
const GDOC_LINK_PATTERN = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g;

// Each top-level observation starts with a new list ID at level 0

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function generateTitle(text: string): string {
  const firstSentence = text.split(/[.!?]\s/)[0];
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.substring(0, 77) + "...";
}

/**
 * Parses Google Docs mobilebasic HTML into episodes and chunks.
 *
 * Structure:
 * - <h1> tags contain episode dates (e.g., "4/6/26")
 * - Content between h1 tags is the episode body
 * - Within an episode, each observation starts with a new top-level list:
 *   <ul class="lst-kix_[unique-id]-0 start">
 *   Sub-points use the same list ID at higher nesting levels (-1, -2, etc.)
 */
export function parseHtmlDocument(html: string): ParsedEpisode[] {
  const episodes: ParsedEpisode[] = [];

  const sections = html.split(/<h1\b[^>]*>/);

  for (const section of sections) {
    const h1End = section.indexOf("</h1>");
    if (h1End === -1) continue;

    const h1Content = stripHtml(section.substring(0, h1End));
    const dateMatch = h1Content.match(DATE_PATTERN);
    if (!dateMatch) continue;

    const parsedDate = parseEpisodeDate(dateMatch[0]);
    if (!parsedDate) continue;

    const headingId =
      html.match(new RegExp(`id="([^"]*)"[^>]*>\\s*<span[^>]*>${dateMatch[0]}`))?.[1] || "";

    const body = section.substring(h1End + 5);
    const chunks = splitIntoChunks(body);

    episodes.push({
      dateStr: dateMatch[0],
      parsedDate,
      title: `Bits and Bobs ${dateMatch[0]}`,
      headingId,
      chunks: chunks.map((content, i) => {
        const plainText = stripHtml(content);
        return {
          title: generateTitle(plainText),
          content: plainText,
          contentPlain: plainText,
          headingId: "",
          position: i,
        };
      }),
    });
  }

  return episodes;
}

function splitIntoChunks(html: string): string[] {
  // Split on level-0 list starts: each <ul class="lst-kix_*-0 start"> marks a new observation.
  // Everything between two boundaries (including nested sub-lists) is one chunk.
  // Match <ul class="...lst-kix_ID-0 start..." ...> — the closing > may be after other attributes
  const boundaryRegex = /<ul\s+class="[^"]*lst-kix_[a-z0-9_]+-0\s+start[^"]*"[^>]*>/g;
  const boundaries: number[] = [];
  let match;
  while ((match = boundaryRegex.exec(html)) !== null) {
    boundaries.push(match.index);
  }

  if (boundaries.length === 0) {
    // Fallback: treat entire body as one chunk if no list structure found
    const text = stripHtml(html);
    return text.length > 10 ? [html] : [];
  }

  const chunks: string[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : html.length;
    const segment = html.substring(start, end);
    const text = stripHtml(segment);
    if (text.length > 10) {
      chunks.push(segment);
    }
  }

  return chunks;
}

export function extractDocLinksFromHtml(html: string): string[] {
  const links = new Set<string>();
  let match;
  const regex = new RegExp(GDOC_LINK_PATTERN);
  while ((match = regex.exec(html)) !== null) {
    links.add(match[1]);
  }
  return [...links];
}

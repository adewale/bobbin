import { parseEpisodeDate } from "../lib/date";
import type { ParsedEpisode, ParsedChunk } from "../types";

const DATE_PATTERN = /\d{1,2}\/\d{1,2}\/\d{2,4}/;
const GDOC_LINK_PATTERN = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g;

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
  // Take the first sentence, capped at 80 chars
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
 * - Within an episode, observations are separated by <li style="padding-top:12pt">
 *   (a significant top padding indicates a new observation/chunk)
 */
export function parseHtmlDocument(html: string): ParsedEpisode[] {
  const episodes: ParsedEpisode[] = [];

  // Split on <h1> tags to get sections
  const sections = html.split(/<h1\b[^>]*>/);

  for (const section of sections) {
    // Extract the h1 text (before the closing </h1>)
    const h1End = section.indexOf("</h1>");
    if (h1End === -1) continue;

    const h1Content = stripHtml(section.substring(0, h1End));
    const dateMatch = h1Content.match(DATE_PATTERN);
    if (!dateMatch) continue;

    const parsedDate = parseEpisodeDate(dateMatch[0]);
    if (!parsedDate) continue;

    // Extract heading ID
    const idMatch = sections[0] === section ? "" : "";
    const headingId =
      html.match(new RegExp(`id="([^"]*)"[^>]*>\\s*<span[^>]*>${dateMatch[0]}`))?.[1] || "";

    // Get body content after </h1>
    const body = section.substring(h1End + 5);

    // Split into chunks by <li style="padding-top:12pt"> which indicates a new observation
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
  // Split on list items with significant top padding (new observation)
  // The pattern is: <li style="...padding-top:12pt...">
  const parts = html.split(/<li\s+style="[^"]*padding-top:\s*12pt[^"]*">/);

  const chunks: string[] = [];
  for (const part of parts) {
    const text = stripHtml(part);
    if (text.length > 10) {
      chunks.push(part);
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

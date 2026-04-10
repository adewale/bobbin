import { parseEpisodeDate } from "../lib/date";
import { decodeHtmlEntities } from "../lib/html";
import type { ParsedEpisode } from "../types";

const DATE_PATTERN = /\d{1,2}\/\d{1,2}\/\d{2,4}/;

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html.replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function generateTitle(text: string): string {
  // Use just the first sentence of the main observation (level-0 text),
  // capped at 80 chars. This is the "headline" of the observation.
  const firstLine = text.split(/\n/)[0].trim();
  const firstSentence = firstLine.split(/[.!?](?:\s|$)/)[0].trim();
  if (!firstSentence) return firstLine.substring(0, 77) + (firstLine.length > 77 ? "..." : "");
  if (firstSentence.length <= 72) return firstSentence;
  // Cut at last word boundary before 80 chars
  const cut = firstSentence.substring(0, 72).replace(/\s+\S*$/, "");
  return cut + "...";
}

/**
 * Parses Google Docs mobilebasic HTML into episodes and chunks.
 *
 * Structure:
 * - <h1> tags contain episode dates
 * - Each episode is a single list with items at different nesting levels:
 *   - margin-left:36pt  = level 0: a standalone observation (chunk boundary)
 *   - margin-left:72pt  = level 1: sub-point of the current observation
 *   - margin-left:108pt = level 2: sub-sub-point
 * - Each level-0 item + its sub-points = one chunk
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
      html.match(
        new RegExp(`id="([^"]*)"[^>]*>\\s*<span[^>]*>${dateMatch[0]}`)
      )?.[1] || "";

    const body = section.substring(h1End + 5);
    const chunks = splitByObservations(body);

    episodes.push({
      dateStr: dateMatch[0],
      parsedDate,
      title: `Bits and Bobs ${dateMatch[0]}`,
      headingId,
      chunks: chunks.map((c, i) => ({
        title: generateTitle(c.mainText),
        content: c.fullText,
        contentPlain: c.fullText,
        headingId: "",
        position: i,
      })),
    });
  }

  return episodes;
}

interface ObservationChunk {
  mainText: string; // Just the level-0 text (for title generation)
  fullText: string; // Level-0 + all sub-points (for content)
}

function splitByObservations(html: string): ObservationChunk[] {
  // Find all list items with their margin-left values
  const itemRegex =
    /<li[^>]*margin-left:\s*(\d+)pt[^>]*>([\s\S]*?)(?=<\/li>)/g;
  const items: { margin: number; html: string }[] = [];
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    items.push({ margin: parseInt(match[1], 10), html: match[2] });
  }

  if (!items.length) {
    const text = stripHtml(html);
    if (text.length > 10) {
      return [{ mainText: text, fullText: text }];
    }
    return [];
  }

  // A new observation starts when margin returns to 36pt from a deeper level.
  // Sequential 36pt items are continuation paragraphs of the same observation.
  const chunks: ObservationChunk[] = [];
  let currentMain = "";
  let currentFull: string[] = [];

  for (const item of items) {
    const text = stripHtml(item.html);
    if (!text) continue;

    const isTopLevel = item.margin <= 36;
    const isFirstItem = !currentMain;

    if ((isTopLevel && !isFirstItem) || isFirstItem) {
      // Flush previous observation
      if (currentMain) {
        chunks.push({
          mainText: currentMain,
          fullText: currentFull.join("\n"),
        });
      }
      currentMain = text;
      currentFull = [text];
    } else {
      // Continuation of current observation (same level or sub-level)
      currentFull.push(text);
    }

  }

  if (currentMain) {
    chunks.push({
      mainText: currentMain,
      fullText: currentFull.join("\n"),
    });
  }

  return chunks;
}

export function extractDocLinksFromHtml(html: string): string[] {
  const links = new Set<string>();
  const regex = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    links.add(match[1]);
  }
  return [...links];
}

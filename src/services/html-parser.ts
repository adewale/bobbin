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
  // Use the full first sentence as the title. Komoroske writes in aphorisms —
  // the first sentence IS the observation. Don't truncate.
  const firstLine = text.split(/\n/)[0].trim();

  // Find the first sentence boundary (.!? followed by space or end)
  const sentenceEnd = firstLine.match(/[.!?](?:\s|$)/);
  if (sentenceEnd && sentenceEnd.index !== undefined) {
    const sentence = firstLine.substring(0, sentenceEnd.index + 1).trim();
    if (sentence.length > 0) return sentence;
  }

  // No sentence boundary — use the full first line
  return firstLine;
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
    const format = detectFormat(chunks);

    episodes.push({
      dateStr: dateMatch[0],
      parsedDate,
      title: `Bits and Bobs ${dateMatch[0]}`,
      headingId,
      format,
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
  mainText: string;
  fullText: string;
}

function splitByObservations(html: string): ObservationChunk[] {
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

  const chunks: ObservationChunk[] = [];
  let currentMain = "";
  let currentFull: string[] = [];

  for (const item of items) {
    const text = stripHtml(item.html);
    if (!text) continue;

    const isTopLevel = item.margin <= 36;
    const isFirstItem = !currentMain;

    if ((isTopLevel && !isFirstItem) || isFirstItem) {
      if (currentMain) {
        chunks.push({
          mainText: currentMain,
          fullText: currentFull.join("\n"),
        });
      }
      currentMain = text;
      currentFull = [text];
    } else {
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

/**
 * Detect whether an episode's chunks represent essays (rich, few) or notes (brief, many).
 */
function detectFormat(chunks: ObservationChunk[]): "essays" | "notes" {
  if (chunks.length === 0) return "notes";
  if (chunks.length > 12) return "notes";
  const avgLines =
    chunks.reduce((sum, c) => sum + c.fullText.split("\n").length, 0) / chunks.length;
  return avgLines >= 3 ? "essays" : "notes";
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

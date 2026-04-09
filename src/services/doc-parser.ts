import { parseEpisodeDate } from "../lib/date";
import type { ParsedEpisode, ParsedChunk } from "../types";

// Google Docs API types (subset we need)
interface GDocDocument {
  documentId: string;
  title: string;
  revisionId: string;
  body: {
    content: GDocStructuralElement[];
  };
}

interface GDocStructuralElement {
  paragraph?: GDocParagraph;
  sectionBreak?: unknown;
  table?: unknown;
}

interface GDocParagraph {
  elements: GDocParagraphElement[];
  paragraphStyle: {
    namedStyleType: string;
    headingId?: string;
  };
}

interface GDocParagraphElement {
  textRun?: {
    content: string;
    textStyle: {
      link?: {
        url?: string;
      };
    };
  };
}

export type { GDocDocument };

const DATE_PATTERN = /\d{1,2}\/\d{1,2}\/\d{2,4}/;
const EPISODE_HEADING_STYLES = new Set(["HEADING_1", "HEADING_2"]);
const CHUNK_HEADING_STYLES = new Set(["HEADING_2", "HEADING_3"]);

function getParagraphText(paragraph: GDocParagraph): string {
  return paragraph.elements
    .map((el) => el.textRun?.content ?? "")
    .join("")
    .replace(/\n$/, "");
}

function isEpisodeHeading(paragraph: GDocParagraph): boolean {
  const style = paragraph.paragraphStyle.namedStyleType;
  const text = getParagraphText(paragraph);
  return EPISODE_HEADING_STYLES.has(style) && DATE_PATTERN.test(text);
}

function isChunkHeading(
  paragraph: GDocParagraph,
  episodeHeadingStyle: string
): boolean {
  const style = paragraph.paragraphStyle.namedStyleType;
  // Chunk headings are one level below episode headings, or at HEADING_2/3
  if (episodeHeadingStyle === "HEADING_1") {
    return CHUNK_HEADING_STYLES.has(style) && !DATE_PATTERN.test(getParagraphText(paragraph));
  }
  // If episode is HEADING_2, chunks are HEADING_3
  return style === "HEADING_3" && !DATE_PATTERN.test(getParagraphText(paragraph));
}

export function parseDocument(doc: GDocDocument): ParsedEpisode[] {
  const elements = doc.body.content;
  const episodes: ParsedEpisode[] = [];

  let currentEpisode: ParsedEpisode | null = null;
  let currentChunk: { title: string; paragraphs: string[]; headingId: string } | null = null;
  let episodeHeadingStyle = "HEADING_1";

  function flushChunk() {
    if (currentChunk && currentEpisode) {
      const content = currentChunk.paragraphs.join("\n\n");
      const contentPlain = content;
      currentEpisode.chunks.push({
        title: currentChunk.title,
        content,
        contentPlain,
        headingId: currentChunk.headingId,
        position: currentEpisode.chunks.length,
      });
      currentChunk = null;
    }
  }

  function flushEpisode() {
    flushChunk();
    if (currentEpisode) {
      episodes.push(currentEpisode);
      currentEpisode = null;
    }
  }

  for (const element of elements) {
    const paragraph = element.paragraph;
    if (!paragraph) continue;

    if (isEpisodeHeading(paragraph)) {
      flushEpisode();
      const text = getParagraphText(paragraph);
      const date = parseEpisodeDate(text);
      if (!date) continue;

      episodeHeadingStyle = paragraph.paragraphStyle.namedStyleType;
      const dateStr = text.match(DATE_PATTERN)![0];
      currentEpisode = {
        dateStr,
        parsedDate: date,
        title: `Bits and Bobs ${dateStr}`,
        headingId: paragraph.paragraphStyle.headingId || "",
        chunks: [],
      };
      continue;
    }

    if (!currentEpisode) continue;

    if (isChunkHeading(paragraph, episodeHeadingStyle)) {
      flushChunk();
      currentChunk = {
        title: getParagraphText(paragraph),
        paragraphs: [],
        headingId: paragraph.paragraphStyle.headingId || "",
      };
      continue;
    }

    // Normal text paragraph — append to current chunk
    if (currentChunk) {
      const text = getParagraphText(paragraph).trim();
      if (text) {
        currentChunk.paragraphs.push(text);
      }
    }
  }

  flushEpisode();
  return episodes;
}

const GDOC_LINK_PATTERN =
  /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/;

export function extractDocLinks(doc: GDocDocument): string[] {
  const links = new Set<string>();
  const selfId = doc.documentId;

  for (const element of doc.body.content) {
    const paragraph = element.paragraph;
    if (!paragraph) continue;

    for (const el of paragraph.elements) {
      const url = el.textRun?.textStyle?.link?.url;
      if (!url) continue;

      const match = url.match(GDOC_LINK_PATTERN);
      if (match && match[1] !== selfId) {
        links.add(match[1]);
      }
    }
  }

  return [...links];
}

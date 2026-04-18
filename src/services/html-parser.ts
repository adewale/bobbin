import { parseEpisodeDate } from "../lib/date";
import { decodeHtmlEntities, resolveGoogleRedirectUrl } from "../lib/html";
import type { ParsedEpisode, ParsedChunk, RichBlock, RichImage, RichLink, RichTextNode } from "../types";

const DATE_PATTERN = /\d{1,2}\/\d{1,2}\/\d{2,4}/;

interface RichParseResult {
  nodes: RichTextNode[];
  plainText: string;
  markdown: string;
  links: RichLink[];
  images: RichImage[];
}

interface SequenceItem {
  kind: "separator" | "item";
  margin?: number;
  html?: string;
  listStyle?: string | null;
}

interface ObservationChunk {
  mainText: string;
  fullText: string;
  markdown: string;
  richBlocks: RichBlock[];
  links: RichLink[];
  images: RichImage[];
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function collapseWhitespace(text: string): string {
  return decodeHtmlEntities(text).replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u3000]/g, " ").replace(/\s+/g, " ");
}

function generateTitle(text: string): string {
  const firstLine = text.split(/\n/)[0].trim();
  const sentenceEnd = firstLine.match(/[.!?](?:\s|$)/);
  if (sentenceEnd && sentenceEnd.index !== undefined) {
    const sentence = firstLine.substring(0, sentenceEnd.index + 1).trim();
    if (sentence.length > 0) return sentence;
  }
  return firstLine;
}

type FormattingState = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  superscript?: boolean;
  href?: string;
};

function getAttr(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`${attr}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function parseStyleFlags(style: string | null): Partial<FormattingState> {
  const value = (style || "").toLowerCase();
  return {
    ...(value.includes("font-weight:700") || value.includes("font-weight:bold") ? { bold: true } : {}),
    ...(value.includes("font-style:italic") ? { italic: true } : {}),
    ...(value.includes("text-decoration:underline") ? { underline: true } : {}),
    ...(value.includes("text-decoration:line-through") ? { strikethrough: true } : {}),
    ...(value.includes("vertical-align:super") ? { superscript: true } : {}),
  };
}

function pushTextNode(nodes: RichTextNode[], state: FormattingState, text: string) {
  if (!text) return;
  const normalized = collapseWhitespace(text);
  if (!normalized.trim()) return;
  const previous = nodes[nodes.length - 1];
  if (
    previous && previous.type === "text" && previous.href === state.href &&
    !!previous.bold === !!state.bold && !!previous.italic === !!state.italic &&
    !!previous.underline === !!state.underline && !!previous.strikethrough === !!state.strikethrough &&
    !!previous.superscript === !!state.superscript
  ) {
    previous.text = `${previous.text || ""}${normalized}`;
    return;
  }
  nodes.push({
    type: "text",
    text: normalized,
    ...(state.href ? { href: state.href } : {}),
    ...(state.bold ? { bold: true } : {}),
    ...(state.italic ? { italic: true } : {}),
    ...(state.underline ? { underline: true } : {}),
    ...(state.strikethrough ? { strikethrough: true } : {}),
    ...(state.superscript ? { superscript: true } : {}),
  });
}

function markdownWrap(text: string, node: RichTextNode): string {
  let out = text;
  if (node.superscript) out = `<sup>${out}</sup>`;
  if (node.strikethrough) out = `~~${out}~~`;
  if (node.underline) out = `<u>${out}</u>`;
  if (node.italic) out = `*${out}*`;
  if (node.bold) out = `**${out}**`;
  if (node.href) out = `[${out}](${node.href})`;
  return out;
}

function renderNodesToMarkdown(nodes: RichTextNode[]): string {
  return nodes.map((node) => {
    if (node.type === "break") return "  \n";
    if (node.type === "image") return node.src ? `![${node.alt || ""}](${node.src})` : "";
    return markdownWrap(node.text || "", node);
  }).join("").trim();
}

function renderNodesToPlainText(nodes: RichTextNode[]): string {
  return nodes.map((node) => {
    if (node.type === "break") return "\n";
    if (node.type === "image") return node.alt ? `[Image: ${node.alt}]` : "[Image]";
    return node.text || "";
  }).join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseRichInline(html: string): RichParseResult {
  const nodes: RichTextNode[] = [];
  const links: RichLink[] = [];
  const images: RichImage[] = [];
  const stack: Array<{ tag: string; state: FormattingState }> = [{ tag: "root", state: {} }];
  const tokens = html.match(/<[^>]+>|[^<]+/g) || [];

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      pushTextNode(nodes, stack[stack.length - 1].state, token);
      continue;
    }

    const lower = token.toLowerCase();
    if (/^<br\b/i.test(token)) {
      nodes.push({ type: "break" });
      continue;
    }

    if (/^<hr\b/i.test(token)) {
      nodes.push({ type: "break" });
      nodes.push({ type: "break" });
      continue;
    }

    if (/^<img\b/i.test(token)) {
      const src = getAttr(token, "src");
      const alt = decodeHtmlEntities(getAttr(token, "alt") || "");
      if (src) {
        const image = { src: resolveGoogleRedirectUrl(src), alt };
        images.push(image);
        nodes.push({ type: "image", src: image.src, alt: image.alt });
      }
      continue;
    }

    const close = token.match(/^<\/([a-z0-9]+)>$/i);
    if (close) {
      const tag = close[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.splice(i, 1);
          break;
        }
      }
      continue;
    }

    const open = token.match(/^<([a-z0-9]+)\b[^>]*>$/i);
    if (!open) continue;
    const tag = open[1].toLowerCase();
    const current = stack[stack.length - 1].state;
    const next: FormattingState = { ...current };

    if (tag === "a") {
      const href = getAttr(token, "href");
      if (href) next.href = resolveGoogleRedirectUrl(href);
    }
    if (tag === "b" || tag === "strong") next.bold = true;
    if (tag === "i" || tag === "em") next.italic = true;
    if (tag === "u") next.underline = true;
    if (tag === "sup") next.superscript = true;
    if (tag === "s" || tag === "strike" || tag === "del") next.strikethrough = true;

    const styleFlags = parseStyleFlags(getAttr(token, "style"));
    Object.assign(next, styleFlags);

    stack.push({ tag, state: next });
  }

  for (const node of nodes) {
    if (node.type === "text" && node.href) {
      links.push({ text: node.text || "", href: node.href });
    }
  }

  return {
    nodes,
    plainText: renderNodesToPlainText(nodes),
    markdown: renderNodesToMarkdown(nodes),
    links,
    images,
  };
}

function buildMarkdownForBlock(depth: number, markdown: string): string {
  const indent = "  ".repeat(Math.max(depth, 0));
  return `${indent}- ${markdown}`.trimEnd();
}

function parseSequence(bodyHtml: string): SequenceItem[] {
  const sequence: SequenceItem[] = [];
  const regex = /(<hr\b[^>]*>)|(<li\b([^>]*)>([\s\S]*?)(?=<\/li>))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(bodyHtml)) !== null) {
    if (match[1]) {
      sequence.push({ kind: "separator" });
      continue;
    }
    const attrs = match[3] || "";
    const marginMatch = attrs.match(/margin-left:\s*(\d+)pt/i);
    if (!marginMatch) continue;
    sequence.push({
      kind: "item",
      margin: parseInt(marginMatch[1], 10),
      html: match[4],
      listStyle: getAttr(attrs, "class") || null,
    });
  }
  return sequence;
}

function blockFromSequenceItem(item: SequenceItem): { block: RichBlock; markdown: string; links: RichLink[]; images: RichImage[] } | null {
  if (item.kind !== "item" || !item.html || item.margin == null) return null;
  const rich = parseRichInline(item.html);
  if (!rich.plainText) return null;
  const depth = Math.max(Math.round(item.margin / 36) - 1, 0);
  const block: RichBlock = {
    type: "list_item",
    depth,
    listStyle: item.listStyle || "unordered",
    plainText: rich.plainText,
    nodes: rich.nodes,
  };
  return {
    block,
    markdown: buildMarkdownForBlock(depth, rich.markdown || rich.plainText),
    links: rich.links,
    images: rich.images,
  };
}

function splitEpisodeContent(html: string): { chunks: ObservationChunk[]; episodeRichContent: RichBlock[]; episodeMarkdown: string; episodeLinks: RichLink[]; episodeImages: RichImage[] } {
  const sequence = parseSequence(html);

  if (!sequence.some((item) => item.kind === "item")) {
    const rich = parseRichInline(html);
    if (rich.plainText.length <= 10) {
      return { chunks: [], episodeRichContent: [], episodeMarkdown: "", episodeLinks: [], episodeImages: [] };
    }
    const block: RichBlock = {
      type: "list_item",
      depth: 0,
      listStyle: "paragraph",
      plainText: rich.plainText,
      nodes: rich.nodes,
    };
    return {
      chunks: [{
        mainText: rich.plainText,
        fullText: rich.plainText,
        markdown: rich.markdown,
        richBlocks: [block],
        links: rich.links,
        images: rich.images,
      }],
      episodeRichContent: [block],
      episodeMarkdown: rich.markdown,
      episodeLinks: rich.links,
      episodeImages: rich.images,
    };
  }

  const chunks: ObservationChunk[] = [];
  const episodeRichContent: RichBlock[] = [];
  const episodeLinks: RichLink[] = [];
  const episodeImages: RichImage[] = [];
  const episodeMarkdown: string[] = [];

  let currentMain = "";
  let currentFull: string[] = [];
  let currentMarkdown: string[] = [];
  let currentBlocks: RichBlock[] = [];
  let currentLinks: RichLink[] = [];
  let currentImages: RichImage[] = [];

  function flushChunk() {
    if (!currentMain) return;
    chunks.push({
      mainText: currentMain,
      fullText: currentFull.join("\n"),
      markdown: currentMarkdown.join("\n"),
      richBlocks: currentBlocks,
      links: currentLinks,
      images: currentImages,
    });
  }

  for (const item of sequence) {
    if (item.kind === "separator") {
      const separator: RichBlock = { type: "separator", depth: 0, listStyle: null, plainText: "", nodes: [] };
      episodeRichContent.push(separator);
      episodeMarkdown.push("---");
      continue;
    }

    const parsed = blockFromSequenceItem(item);
    if (!parsed) continue;
    episodeRichContent.push(parsed.block);
    episodeMarkdown.push(parsed.markdown);
    episodeLinks.push(...parsed.links);
    episodeImages.push(...parsed.images);

    const isTopLevel = parsed.block.depth === 0;
    const isFirstItem = !currentMain;

    if ((isTopLevel && !isFirstItem) || isFirstItem) {
      flushChunk();
      currentMain = parsed.block.plainText;
      currentFull = [parsed.block.plainText];
      currentMarkdown = [parsed.markdown];
      currentBlocks = [parsed.block];
      currentLinks = [...parsed.links];
      currentImages = [...parsed.images];
    } else {
      currentFull.push(parsed.block.plainText);
      currentMarkdown.push(parsed.markdown);
      currentBlocks.push(parsed.block);
      currentLinks.push(...parsed.links);
      currentImages.push(...parsed.images);
    }
  }

  flushChunk();

  return {
    chunks,
    episodeRichContent,
    episodeMarkdown: episodeMarkdown.join("\n"),
    episodeLinks,
    episodeImages,
  };
}

function detectFormat(chunks: ObservationChunk[]): "essays" | "notes" {
  if (chunks.length === 0) return "notes";
  if (chunks.length > 12) return "notes";
  const avgLines = chunks.reduce((sum, c) => sum + c.fullText.split("\n").length, 0) / chunks.length;
  return avgLines >= 3 ? "essays" : "notes";
}

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

    const headingId = html.match(new RegExp(`id="([^"]*)"[^>]*>\s*<span[^>]*>${dateMatch[0]}`))?.[1] || "";
    const body = section.substring(h1End + 5);
    const split = splitEpisodeContent(body);
    const format = detectFormat(split.chunks);

    const parsedChunks: ParsedChunk[] = split.chunks.map((chunk, i) => ({
      title: generateTitle(chunk.mainText),
      content: chunk.fullText,
      contentPlain: chunk.fullText,
      contentMarkdown: chunk.markdown,
      richContent: chunk.richBlocks.map((block) => ({ ...block, chunkPosition: i })),
      links: chunk.links,
      images: chunk.images,
      headingId: "",
      position: i,
    }));

    episodes.push({
      dateStr: dateMatch[0],
      parsedDate,
      title: `Bits and Bobs ${dateMatch[0]}`,
      headingId,
      format,
      contentMarkdown: split.episodeMarkdown,
      richContent: split.episodeRichContent,
      links: split.episodeLinks,
      images: split.episodeImages,
      chunks: parsedChunks,
    });
  }

  return episodes;
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

export type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  ADMIN_SECRET: string;
  ENRICHMENT_QUEUE: Queue;
  TOPIC_EXTRACTOR_MODE?: "naive" | "yaket" | "yaket_bobbin" | "episode_hybrid";
};

export type AppEnv = {
  Bindings: Bindings;
};

// Database row types
export interface SourceRow {
  id: number;
  google_doc_id: string;
  title: string;
  last_fetched_at: string | null;
  last_revision_id: string | null;
  is_archive: number;
  latest_html: string | null;
  created_at: string;
}

export interface EpisodeRow {
  id: number;
  source_id: number;
  slug: string;
  title: string;
  published_date: string;
  year: number;
  month: number;
  day: number;
  summary: string | null;
  chunk_count: number;
  format: "essays" | "notes";
  content_markdown: string | null;
  rich_content_json: string | null;
  links_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkRow {
  id: number;
  episode_id: number;
  slug: string;
  title: string;
  content: string;
  content_plain: string;
  summary: string | null;
  position: number;
  word_count: number;
  vector_id: string | null;
  content_markdown: string | null;
  rich_content_json: string | null;
  links_json: string | null;
  images_json: string | null;
  footnotes_json: string | null;
  analysis_text: string | null;
  normalization_version: number;
  normalization_warnings: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopicRow {
  id: number;
  name: string;
  slug: string;
  usage_count: number;
  distinctiveness: number;
  kind: string;
  related_slugs: string | null;
  display_suppressed: number;
  display_reason: string | null;
  hidden: number;
  entity_verified: number;
  provenance_complete: number;
}

export interface WordStatsRow {
  id: number;
  word: string;
  total_count: number;
  doc_count: number;
  distinctiveness: number;
  in_baseline: number;
  updated_at: string;
}

// Extended types for JOIN queries
export interface ChunkWithEpisode extends ChunkRow {
  episode_slug: string;
  episode_title: string;
  published_date: string;
  episode_format: string;
}

export interface ConnectedChunk {
  id: number;
  slug: string;
  title: string;
  episode_slug: string;
  published_date: string;
  reach: number;
}

export interface ChunkWordRow {
  chunk_id: number;
  word: string;
  count: number;
}

// Parsed types from Google Docs
export interface ParsedEpisode {
  dateStr: string;
  parsedDate: Date;
  title: string;
  headingId: string;
  format: "essays" | "notes";
  contentMarkdown: string;
  richContent: RichBlock[];
  links: RichLink[];
  images: RichImage[];
  chunks: ParsedChunk[];
}

export interface ParsedChunk {
  title: string;
  content: string;
  contentPlain: string;
  contentMarkdown: string;
  richContent: RichBlock[];
  links: RichLink[];
  images: RichImage[];
  footnotes: RichFootnote[];
  headingId: string;
  position: number;
}

export interface RichLink {
  text: string;
  href: string;
}

export interface RichImage {
  src: string;
  alt: string;
}

export interface RichTextNode {
  type: "text" | "image" | "break";
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  superscript?: boolean;
}

export interface RichFootnote {
  id: string;
  label: string;
  text: string;
}

export interface RichBlock {
  type: "paragraph" | "list_item" | "separator";
  depth: number;
  listStyle?: string | null;
  plainText: string;
  nodes: RichTextNode[];
  chunkSlug?: string;
  chunkTitle?: string;
  chunkPosition?: number;
  anchorIds?: string[];
}

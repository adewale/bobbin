export type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  ADMIN_SECRET: string;
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
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: number;
  name: string;
  slug: string;
  usage_count: number;
}

export interface ConcordanceRow {
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
  chunks: ParsedChunk[];
}

export interface ParsedChunk {
  title: string;
  content: string;
  contentPlain: string;
  headingId: string;
  position: number;
}

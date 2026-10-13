// Workers AI stand-in for the workers-pool tests, bound as `env.AI` through a
// miniflare wrapped binding (see vitest.config.ts). The real binding needs a
// Cloudflare login, so without this every `env.AI` path was dead under test.
//
// Faithful to what bobbin relies on:
// - Embedding models return `{ shape: [n, dims], data: number[][] }` with the
//   model's real dimension count, and reject empty or oversized batches.
// - Embeddings are deterministic and meaningful: a hashed bag of words,
//   L2-normalised, so texts that share words have high cosine similarity and
//   unrelated texts score near 0.
// - Text-generation models validate `messages` and answer
//   `{ response: '{"candidates":[]}' }` (valid JSON, no candidates).
// - Any other model throws, so a new model cannot silently get a junk answer.
//
// Bound locally through WorkerEntrypoint RPC; no provider is contacted.

import { WorkerEntrypoint } from "cloudflare:workers";

const EMBEDDING_DIMENSIONS = {
  "@cf/baai/bge-small-en-v1.5": 384,
  "@cf/baai/bge-base-en-v1.5": 768,
  "@cf/baai/bge-large-en-v1.5": 1024,
};
// Documented Workers AI limit for bge embedding batches.
const MAX_EMBEDDING_BATCH = 100;
const TEXT_GENERATION_MODELS = new Set(["@cf/google/gemma-4-26b-a4b-it"]);

function fnv1a(token) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function embedText(text, dimensions) {
  const vector = new Array(dimensions).fill(0);
  const tokens = String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const hash = fnv1a(token);
    vector[hash % dimensions] += (hash & 0x80000000) ? -1 : 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  // Empty text still gets a unit vector, as a real model would return one.
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((v) => v / norm);
}

function makeWorkersAi() {
  const calls = [];
  return {
    // Test-only introspection; not part of the Ai interface.
    __calls: calls,
    __reset() {
      calls.length = 0;
    },
    async run(model, inputs, options) {
      calls.push({ model, options });
      if (model in EMBEDDING_DIMENSIONS) {
        const text = inputs?.text;
        const texts = typeof text === "string" ? [text] : text;
        if (!Array.isArray(texts) || texts.length === 0) {
          throw new Error(`AiError: ${model}: "text" must be a string or a non-empty array of strings`);
        }
        if (texts.length > MAX_EMBEDDING_BATCH) {
          throw new Error(`AiError: ${model}: at most ${MAX_EMBEDDING_BATCH} texts per request, got ${texts.length}`);
        }
        if (texts.some((t) => typeof t !== "string")) {
          throw new Error(`AiError: ${model}: every "text" entry must be a string`);
        }
        const dims = EMBEDDING_DIMENSIONS[model];
        return { shape: [texts.length, dims], data: texts.map((t) => embedText(t, dims)), pooling: "mean" };
      }
      if (TEXT_GENERATION_MODELS.has(model)) {
        const messages = inputs?.messages;
        if (!Array.isArray(messages) || messages.length === 0 ||
            messages.some((m) => typeof m?.role !== "string" || typeof m?.content !== "string")) {
          throw new Error(`AiError: ${model}: "messages" must be a non-empty array of { role, content } strings`);
        }
        return { response: JSON.stringify({ candidates: [] }) };
      }
      throw new Error(`AiError: fake Workers AI does not implement model ${model}`);
    },
  };
}

// Keep state at module scope: WorkerEntrypoint instances are per RPC call.
const ai = makeWorkersAi();
export class WorkersAiFake extends WorkerEntrypoint {
  run(model, inputs, options) { return ai.run(model, inputs, options); }
  __reset() { ai.__reset(); }
}

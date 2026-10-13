// Vectorize (V2) stand-in for the workers-pool tests, bound as `env.VECTORIZE`
// through a miniflare wrapped binding (see vitest.config.ts). The real binding
// needs a Cloudflare login, so without this every `env.VECTORIZE` path
// (semantic search, embedding upsert, cross-references) was dead under test.
//
// An in-memory cosine index that follows the documented binding behaviour:
// - upsert/deleteByIds return `{ mutationId }`; getByIds returns
//   `{ id, values, metadata }` for the ids that exist.
// - query returns `{ matches, count }` sorted by cosine similarity, capped at
//   topK; values/metadata only when requested (returnValues,
//   returnMetadata "indexed" | "all").
// - Rejects vectors whose dimension differs from the index, and topK above
//   the documented limits (100, or 20 with values or all metadata).
// - Metadata filters: implicit equality, $eq, $ne, $in, $nin, $lt, $lte, $gt,
//   $gte. An unknown operator throws rather than being ignored.
//
// Known simplifications (not verified against the real service):
// - Writes are visible immediately; real Vectorize is eventually consistent.
// - "indexed" returns all metadata; real Vectorize returns only properties
//   with a metadata index.
// - Array-valued metadata (bobbin's `topics`) matches $eq/$in when any
//   element matches. This mirrors how bobbin's topic filter is written.
//
// State lives in this binding instance. test/setup/reset-fakes.ts clears it
// before every test, matching the per-test D1 reset in the test files.
// Bound locally through WorkerEntrypoint RPC; no provider is contacted.

import { WorkerEntrypoint } from "cloudflare:workers";

const MAX_TOP_K = 100;
const MAX_TOP_K_WITH_VALUES_OR_METADATA = 20;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function valueMatches(actual, op, expected) {
  const values = Array.isArray(actual) ? actual : [actual];
  switch (op) {
    case "$eq": return values.some((v) => v === expected);
    case "$ne": return !values.some((v) => v === expected);
    case "$in": return values.some((v) => expected.includes(v));
    case "$nin": return !values.some((v) => expected.includes(v));
    case "$lt": return values.some((v) => v !== undefined && v < expected);
    case "$lte": return values.some((v) => v !== undefined && v <= expected);
    case "$gt": return values.some((v) => v !== undefined && v > expected);
    case "$gte": return values.some((v) => v !== undefined && v >= expected);
    default: throw new Error(`VectorizeError: unsupported filter operator ${op}`);
  }
}

function matchesFilter(metadata, filter) {
  for (const [field, condition] of Object.entries(filter)) {
    const actual = metadata?.[field];
    if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
      for (const [op, expected] of Object.entries(condition)) {
        if (!valueMatches(actual, op, expected)) return false;
      }
    } else if (!valueMatches(actual, "$eq", condition)) {
      return false;
    }
  }
  return true;
}

function makeVectorize(env) {
  const dimensions = Number(env.DIMENSIONS ?? 768);
  const store = new Map();
  let mutations = 0;
  const mutationId = () => `fake-mutation-${++mutations}`;

  function checkVector(vector) {
    if (typeof vector?.id !== "string" || vector.id.length === 0) {
      throw new Error("VectorizeError: vector id must be a non-empty string");
    }
    const values = Array.from(vector.values ?? []);
    if (values.length !== dimensions) {
      throw new Error(`VectorizeError: vector ${vector.id} has ${values.length} dimensions, index expects ${dimensions}`);
    }
    return { id: vector.id, values, metadata: vector.metadata ?? {}, namespace: vector.namespace };
  }

  return {
    // Test-only: not part of the Vectorize interface.
    async __reset() {
      store.clear();
    },
    async describe() {
      return {
        name: "bobbin-chunks-fake",
        config: { dimensions, metric: "cosine" },
        vectorCount: store.size,
        processedUpToMutation: mutations,
        processedUpToDatetime: new Date(0).toISOString(),
      };
    },
    async upsert(vectors) {
      const checked = vectors.map(checkVector);
      for (const v of checked) store.set(v.id, v);
      return { mutationId: mutationId() };
    },
    async insert() {
      throw new Error("fake Vectorize does not implement insert(); bobbin uses upsert()");
    },
    async getByIds(ids) {
      return ids.filter((id) => store.has(id)).map((id) => structuredClone(store.get(id)));
    },
    async deleteByIds(ids) {
      for (const id of ids) store.delete(id);
      return { mutationId: mutationId() };
    },
    async query(vector, options = {}) {
      const values = Array.from(vector ?? []);
      if (values.length !== dimensions) {
        throw new Error(`VectorizeError: query vector has ${values.length} dimensions, index expects ${dimensions}`);
      }
      const topK = options.topK ?? 5;
      const returnMetadata = options.returnMetadata === true ? "all" : (options.returnMetadata || "none");
      const heavy = options.returnValues === true || returnMetadata === "all";
      const limit = heavy ? MAX_TOP_K_WITH_VALUES_OR_METADATA : MAX_TOP_K;
      if (!Number.isInteger(topK) || topK < 1 || topK > limit) {
        throw new Error(`VectorizeError: topK must be between 1 and ${limit} for these options, got ${topK}`);
      }
      const matches = [...store.values()]
        .filter((v) => (options.namespace === undefined || v.namespace === options.namespace))
        .filter((v) => (options.filter ? matchesFilter(v.metadata, options.filter) : true))
        .map((v) => ({
          id: v.id,
          score: cosine(values, v.values),
          ...(options.returnValues ? { values: [...v.values] } : {}),
          ...(returnMetadata !== "none" ? { metadata: structuredClone(v.metadata) } : {}),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { matches, count: matches.length };
    },
    async queryById() {
      throw new Error("fake Vectorize does not implement queryById()");
    },
  };
}

// Keep the existing 768-dimensional index alive across individual RPC calls.
const vectorize = makeVectorize({ DIMENSIONS: 768 });
export class VectorizeFake extends WorkerEntrypoint {
  __reset() { return vectorize.__reset(); }
  describe() { return vectorize.describe(); }
  upsert(vectors) { return vectorize.upsert(vectors); }
  insert() { return vectorize.insert(); }
  getByIds(ids) { return vectorize.getByIds(ids); }
  deleteByIds(ids) { return vectorize.deleteByIds(ids); }
  query(vector, options) { return vectorize.query(vector, options); }
  queryById() { return vectorize.queryById(); }
}

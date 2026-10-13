export const MAX_SQL_BINDINGS = 90;

export function chunkForSqlBindings<T>(values: readonly T[], maxBindings = MAX_SQL_BINDINGS): T[][] {
  if (maxBindings < 1) {
    throw new Error("maxBindings must be positive");
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += maxBindings) {
    chunks.push(values.slice(index, index + maxBindings));
  }
  return chunks;
}

export function sqlPlaceholders(count: number): string {
  if (count < 1) {
    throw new Error("count must be positive");
  }

  return Array.from({ length: count }, () => "?").join(",");
}

export async function collectInBatches<TValue, TResult>(
  values: readonly TValue[],
  runBatch: (batch: TValue[]) => Promise<readonly TResult[]>,
  maxBindings = MAX_SQL_BINDINGS,
): Promise<TResult[]> {
  const results: TResult[] = [];
  for (const batch of chunkForSqlBindings(values, maxBindings)) {
    results.push(...await runBatch(batch));
  }
  return results;
}

export async function batchExec(db: D1Database, stmts: Iterable<D1PreparedStatement>, size = 100) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("batch size must be a positive integer");
  let batch: D1PreparedStatement[] = [];
  for (const statement of stmts) {
    batch.push(statement);
    if (batch.length === size) {
      await db.batch(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await db.batch(batch);
}

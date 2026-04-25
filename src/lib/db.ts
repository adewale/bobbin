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

export async function batchExec(db: D1Database, stmts: D1PreparedStatement[], size = 100) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}

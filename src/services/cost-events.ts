export type CloudflareCostProduct = "workers_ai" | "vectorize";

export interface CostEventInput {
  product: CloudflareCostProduct;
  operation: string;
  units?: number;
  route?: string;
  detail?: unknown;
}

export async function recordCostEvent(db: D1Database, input: CostEventInput): Promise<void> {
  await db.prepare(
    `INSERT INTO cloudflare_cost_events (product, operation, units, route, detail)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    input.product,
    input.operation,
    Math.max(1, Math.round(input.units ?? 1)),
    input.route ?? null,
    input.detail === undefined ? null : JSON.stringify(input.detail).slice(0, 1000),
  ).run();
}

export function safeBackground(task: Promise<unknown>, c?: any): void {
  try {
    c?.executionCtx?.waitUntil(task);
  } catch {
    task.catch(() => undefined);
  }
}

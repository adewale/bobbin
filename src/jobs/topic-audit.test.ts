import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations } from "../../test/helpers/migrations";
import { runTopicAuditBenchmark } from "./topic-audit";

beforeEach(async () => {
  await applyTestMigrations(env.DB);
});

describe("topic audit benchmark", () => {
  it("keeps yaket_bobbin at least as precise as raw yaket on the audit corpus", async () => {
    const raw = await runTopicAuditBenchmark(env.DB, "yaket");
    await applyTestMigrations(env.DB);
    const tuned = await runTopicAuditBenchmark(env.DB, "yaket_bobbin");

    console.log(`TOPIC_AUDIT raw=${JSON.stringify(raw)} tuned=${JSON.stringify(tuned)}`);

    expect(tuned.precisionAt5).toBeGreaterThanOrEqual(raw.precisionAt5);
    expect(tuned.recallAt5).toBeGreaterThanOrEqual(raw.recallAt5);
    expect(tuned.precisionAt10).toBeGreaterThanOrEqual(raw.precisionAt10);
    expect(tuned.recallAt10).toBeGreaterThanOrEqual(raw.recallAt10);
  }, 120000);
});

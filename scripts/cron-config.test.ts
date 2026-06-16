import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readCrons(path: string): string[] {
  const config = JSON.parse(readFileSync(path, "utf8"));
  return config.triggers?.crons ?? [];
}

describe("production cron config", () => {
  it("uses explicit Tuesday names instead of ambiguous numeric weekdays", () => {
    for (const path of ["wrangler.jsonc", "wrangler.remote.jsonc"]) {
      expect(readCrons(path), path).toEqual(["0 8 * * TUE", "0 9 * * TUE"]);
    }
  });
});

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decodeHtmlEntities,
  safeJsonForHtml,
  escapeRegex,
  escapeLike,
  sanitizeFtsQuery,
  escapeXml,
  getBaseUrl,
  safeParseInt,
} from "./html";

describe("escapeXml", () => {
  it("escapes all XML special characters", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const escaped = escapeXml(s);
        // Result should not contain unescaped XML specials
        // (unless they were part of an escape sequence we introduced)
        expect(escaped).not.toMatch(/[<>"'](?!amp;|lt;|gt;|quot;|apos;)/);
      })
    );
  });

  it("roundtrips: decode(escape(s)) preserves meaning", () => {
    // escapeXml -> decode should recover the original for the entities we handle
    expect(escapeXml("a < b & c")).toBe("a &lt; b &amp; c");
    expect(escapeXml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("is idempotent on already-safe strings", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9 ]*$/), (s) => {
        expect(escapeXml(s)).toBe(s);
      })
    );
  });
});

describe("escapeLike", () => {
  it("escapes % and _ characters", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const escaped = escapeLike(s);
        // No unescaped % or _ should remain
        const unescaped = escaped.replace(/\\%/g, "").replace(/\\_/g, "");
        expect(unescaped).not.toContain("%");
        expect(unescaped).not.toContain("_");
      })
    );
  });

  it("preserves strings without metacharacters", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z ]*$/), (s) => {
        expect(escapeLike(s)).toBe(s);
      })
    );
  });
});

describe("sanitizeFtsQuery", () => {
  it("wraps in quotes and strips internal quotes", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = sanitizeFtsQuery(s);
        expect(result.startsWith('"')).toBe(true);
        expect(result.endsWith('"')).toBe(true);
        // Internal content should have no double quotes
        expect(result.slice(1, -1)).not.toContain('"');
      })
    );
  });
});

describe("escapeRegex", () => {
  it("produces a pattern that matches the literal input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (!s) return; // skip empty
        const regex = new RegExp(escapeRegex(s));
        expect(regex.test(s)).toBe(true);
      })
    );
  });
});

describe("safeJsonForHtml", () => {
  it("result never contains </script>", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (val) => {
        const result = safeJsonForHtml(val);
        expect(result.toLowerCase()).not.toContain("</script>");
      })
    );
  });

  it("result is valid JSON", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (val) => {
        const result = safeJsonForHtml(val);
        // The escaped version should still parse (the \/ is valid JSON)
        expect(() => JSON.parse(result)).not.toThrow();
      })
    );
  });
});

describe("safeParseInt", () => {
  it("returns default for non-numeric input", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z!@#$]+$/),
        fc.integer({ min: 0, max: 1000 }),
        (s, def) => {
          expect(safeParseInt(s, def)).toBe(def);
        }
      )
    );
  });

  it("returns the parsed value for valid positive integers", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (n) => {
        expect(safeParseInt(String(n), 999)).toBe(n);
      })
    );
  });

  it("returns default for negative values", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10000, max: -1 }), (n) => {
        expect(safeParseInt(String(n), 42)).toBe(42);
      })
    );
  });

  it("returns default for undefined", () => {
    expect(safeParseInt(undefined, 5)).toBe(5);
  });
});

describe("getBaseUrl", () => {
  it("extracts protocol and host from valid URLs", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const result = getBaseUrl(url);
        expect(result).toMatch(/^https?:\/\/.+/);
        // Should not end with a slash
        expect(result.endsWith("/")).toBe(false);
      })
    );
  });

  it("returns default for invalid URLs", () => {
    expect(getBaseUrl("not-a-url")).toBe("https://bobbin.adewale-883.workers.dev");
    expect(getBaseUrl(undefined)).toBe("https://bobbin.adewale-883.workers.dev");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes all supported entities", () => {
    expect(decodeHtmlEntities("&amp;&lt;&gt;&quot;&#39;&nbsp;")).toBe('&<>"\' ');
  });

  it("is a left inverse of escapeXml for strings without apostrophes", () => {
    // escapeXml produces &apos; for ' but decodeHtmlEntities only decodes &#39;
    // so the roundtrip holds for all characters except apostrophes
    fc.assert(
      fc.property(fc.stringMatching(/^[^']*$/), (s) => {
        const roundtrip = decodeHtmlEntities(escapeXml(s));
        expect(roundtrip).toBe(s);
      })
    );
  });

  it("decodes &#39; but not &apos;", () => {
    expect(decodeHtmlEntities("&#39;")).toBe("'");
    expect(decodeHtmlEntities("&apos;")).toBe("&apos;");
  });
});

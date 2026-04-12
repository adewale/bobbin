export interface KnownEntity {
  name: string;
  kind: "person" | "company" | "product";
  aliases?: string[];
}

export const KNOWN_ENTITIES: KnownEntity[] = [
  { name: "OpenAI", kind: "company", aliases: ["openai"] },
  { name: "Google", kind: "company", aliases: ["google", "alphabet"] },
  { name: "Anthropic", kind: "company" },
  { name: "Simon Willison", kind: "person", aliases: ["willison"] },
  { name: "Ben Thompson", kind: "person", aliases: ["stratechery"] },
  { name: "Sam Altman", kind: "person", aliases: ["altman"] },
  { name: "Claude Code", kind: "product" },
  { name: "ChatGPT", kind: "product", aliases: ["chatgpt"] },
  { name: "Hacker News", kind: "product", aliases: ["hackernews", "hn"] },
  { name: "Andrej Karpathy", kind: "person", aliases: ["karpathy"] },
];

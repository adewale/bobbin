export interface KnownEntity {
  name: string;
  kind: "person" | "company" | "product";
  aliases?: string[];
}

export const KNOWN_ENTITIES: KnownEntity[] = [
  // Companies
  { name: "OpenAI", kind: "company", aliases: ["openai"] },
  { name: "Google", kind: "company", aliases: ["google", "alphabet", "deepmind"] },
  { name: "Anthropic", kind: "company", aliases: ["anthropic"] },
  { name: "Meta", kind: "company", aliases: ["meta", "facebook"] },
  { name: "Microsoft", kind: "company", aliases: ["microsoft"] },
  { name: "Apple", kind: "company", aliases: ["apple"] },
  { name: "Amazon", kind: "company", aliases: ["amazon", "aws"] },

  // People
  { name: "Simon Willison", kind: "person", aliases: ["willison"] },
  { name: "Ben Thompson", kind: "person", aliases: ["stratechery", "thompson"] },
  { name: "Sam Altman", kind: "person", aliases: ["altman"] },
  { name: "Andrej Karpathy", kind: "person", aliases: ["karpathy"] },
  { name: "Ethan Mollick", kind: "person", aliases: ["mollick"] },
  { name: "Satya Nadella", kind: "person", aliases: ["nadella"] },
  { name: "Jensen Huang", kind: "person", aliases: ["huang", "jensen"] },
  { name: "Dario Amodei", kind: "person", aliases: ["amodei"] },

  // Products
  { name: "Claude Code", kind: "product", aliases: ["claude code"] },
  { name: "ChatGPT", kind: "product", aliases: ["chatgpt", "gpt-4", "gpt4"] },
  { name: "Claude", kind: "product", aliases: ["claude"] },
  { name: "Gemini", kind: "product", aliases: ["gemini"] },
  { name: "Hacker News", kind: "product", aliases: ["hacker news", "hackernews", "hn"] },
  { name: "Stratechery", kind: "product", aliases: ["stratechery"] },
  { name: "Cursor", kind: "product", aliases: ["cursor"] },
  { name: "Copilot", kind: "product", aliases: ["copilot", "github copilot"] },
];

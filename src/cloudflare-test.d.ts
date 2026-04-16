declare module "cloudflare:test" {
  export const env: import("./types").Bindings & Record<string, unknown>;
  export const SELF: Fetcher;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

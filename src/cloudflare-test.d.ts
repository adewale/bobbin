declare module "cloudflare:test" {
  export const env: Cloudflare.Env;
  export const SELF: Fetcher;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

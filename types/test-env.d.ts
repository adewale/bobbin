/// <reference types="@cloudflare/vitest-pool-workers/types/cloudflare-test" />

declare module "*?raw" {
  const content: string;
  export default content;
}

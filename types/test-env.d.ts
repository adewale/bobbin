/// <reference types="@cloudflare/vitest-plugin/types" />

declare module "*?raw" {
  const content: string;
  export default content;
}

export function aiGatewayOptions(gatewayId?: string, cacheKey?: string): AiOptions | undefined {
  if (!gatewayId) return undefined;
  return {
    gateway: {
      id: gatewayId,
      cacheKey,
      cacheTtl: 3600,
      collectLog: true,
      retries: { maxAttempts: 3, retryDelayMs: 500, backoff: "exponential" },
    },
  };
}

export async function generateEmbeddings(
  ai: Ai,
  texts: string[],
  gatewayId?: string,
  cacheKey?: string,
): Promise<number[][]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", {
    text: texts,
  }, aiGatewayOptions(gatewayId, cacheKey));
  return (result as any).data;
}

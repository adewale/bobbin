export async function generateEmbedding(
  ai: Ai,
  text: string
): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });
  return (result as any).data[0];
}

export async function generateEmbeddings(
  ai: Ai,
  texts: string[]
): Promise<number[][]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", {
    text: texts,
  });
  return (result as any).data;
}

export async function generateSummary(
  ai: Ai,
  text: string
): Promise<string> {
  const result = await ai.run("@cf/facebook/bart-large-cnn", {
    input_text: text,
    max_length: 150,
  });
  return (result as any).summary;
}

/**
 * Fetches a Google Doc as HTML via the mobilebasic endpoint.
 * No authentication required — works for any doc shared with "anyone with the link".
 */
export async function fetchGoogleDocHtml(
  docId: string
): Promise<string> {
  const url = `https://docs.google.com/document/d/${docId}/mobilebasic`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch doc ${docId}: ${response.status}`
    );
  }

  return response.text();
}

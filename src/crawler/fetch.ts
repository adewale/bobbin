/**
 * Content fetching — HTTP only, no parsing or DB access.
 * Returns raw HTML for downstream processing.
 */

export interface FetchResult {
  docId: string;
  html: string;
  fetchedAt: string;
}

/**
 * Fetch a Google Doc as HTML via the mobilebasic endpoint.
 * No authentication required — works for any doc shared with "anyone with the link".
 */
export async function fetchGoogleDoc(docId: string): Promise<FetchResult> {
  const url = `https://docs.google.com/document/d/${docId}/mobilebasic`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch doc ${docId}: ${response.status}`);
  }

  return {
    docId,
    html: await response.text(),
    fetchedAt: new Date().toISOString(),
  };
}

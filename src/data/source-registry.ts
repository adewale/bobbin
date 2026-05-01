export interface KnownSource {
  docId: string;
  title: string;
  isArchive: number;
}

export const KNOWN_SOURCES: KnownSource[] = [
  {
    docId: "1xRiCqpy3LMAgEsHdX-IA23j6nUISdT5nAJmtKbk9wNA",
    title: "Bits and Bobs (Current)",
    isArchive: 0,
  },
  {
    docId: "1WC16fr5iEwzpK8u11yvYd6cCHPvq6Ce4WnrkpJ49vYw",
    title: "Archive (Notes)",
    isArchive: 1,
  },
  {
    docId: "1BZCiakRHDd2I337FmJv8RGcrcycapXPXN_wHPO5-DaA",
    title: "Archive (2023-2024)",
    isArchive: 1,
  },
];

export function describeSource(docId: string): KnownSource | null {
  return KNOWN_SOURCES.find((source) => source.docId === docId) || null;
}

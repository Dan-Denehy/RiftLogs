export const ARTWORK_ORIGIN = "https://assets.riftatlas-workers.com";

export function safeArtworkUrl(value?: string | null): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.origin === ARTWORK_ORIGIN && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

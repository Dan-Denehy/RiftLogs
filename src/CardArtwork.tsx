import { useState } from "react";
import { safeArtworkUrl } from "./artworkPolicy";
export { safeArtworkUrl } from "./artworkPolicy";

export default function CardArtwork({ name, url, fallbackUrl, hidden = false, landscape = false }: {
  name: string; url?: string | null; fallbackUrl?: string | null; hidden?: boolean; landscape?: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const candidates = hidden ? [] : [safeArtworkUrl(url), safeArtworkUrl(fallbackUrl)];
  const source = candidates.find((candidate): candidate is string => !!candidate && !failed.includes(candidate));
  return <span className={`card-artwork ${landscape ? "is-landscape" : ""} ${hidden ? "is-card-back" : ""}`}>
    {source ? <img src={source} alt={name} loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer"
      onError={() => setFailed((previous) => [...previous, source])} />
      : <span className="card-artwork-fallback"><span aria-hidden="true" className="card-back-sigil">◇</span>
        <strong>{hidden ? "Hidden card" : name}</strong><small>{hidden ? "Identity not revealed" : "Artwork unavailable"}</small></span>}
  </span>;
}

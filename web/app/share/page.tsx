"use client";

// Destino de "Compartir" en Android cuando la web está instalada como PWA
// (share_target del manifest). La app de YouTube manda el enlace en `text`,
// no en `url`, así que se busca en los tres campos.

import { useEffect, useState } from "react";
import { parseVideoId } from "@/lib/merge";

export default function Share({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const [msg, setMsg] = useState("Añadiendo…");

  useEffect(() => {
    const candidates = [searchParams.url, searchParams.text, searchParams.title]
      .flatMap((s) => (s ?? "").split(/\s+/));
    const link = candidates.find((s) => parseVideoId(s));
    if (!link) return setMsg("Eso no parece un vídeo de YouTube.");

    void (async () => {
      const meta = await fetch(`/api/meta?url=${encodeURIComponent(link)}`);
      if (meta.status === 401) return void (window.location.href = "/login");
      const j = await meta.json();
      const r = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          since: Date.now(),
          changes: [{ videoId: j.videoId, title: j.title, channel: j.channel, queued: true, queuedAt: Date.now() }],
        }),
      });
      if (!r.ok) return setMsg("No se pudo guardar. Inténtalo de nuevo.");
      window.location.replace("/");
    })();
  }, [searchParams]);

  return <main className="shell"><p className="muted">{msg}</p></main>;
}

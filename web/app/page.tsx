"use client";

// Pantalla principal: añadir por enlace, "Por ver", "Seguir viendo" y "Vistos".
// No hay feed, ni recomendaciones, ni búsqueda: a esta app se viene con el vídeo
// ya elegido.

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtTime, thumb, useLibrary } from "@/lib/useLibrary";
import type { Video } from "@/lib/types";

type Tab = "queue" | "progress" | "watched";

const TABS: { id: Tab; label: string }[] = [
  { id: "queue", label: "Por ver" },
  { id: "progress", label: "Seguir viendo" },
  { id: "watched", label: "Vistos" },
];

export default function Home() {
  const lib = useLibrary();
  const [tab, setTab] = useState<Tab>("queue");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const lists = useMemo(() => {
    const all = [...lib.videos.values()];
    return {
      queue: all.filter((v) => v.queued).sort((a, b) => a.queuedAt - b.queuedAt),
      progress: all
        .filter((v) => !v.watched && v.positionSec > 0)
        .sort((a, b) => b.positionAt - a.positionAt),
      watched: all.filter((v) => v.watched).sort((a, b) => b.watchedAt - a.watchedAt),
    };
  }, [lib.videos]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const r = await fetch(`/api/meta?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      lib.change({
        videoId: j.videoId,
        title: j.title,
        channel: j.channel,
        queued: true,
        queuedAt: Date.now(),
      });
      setUrl("");
      setTab("queue");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  const items = lists[tab];

  return (
    <main className="shell">
      <header className="top">
        <h1>yt</h1>
        <Link href="/ajustes" className="link-muted">
          Dispositivos
        </Link>
      </header>

      <form className="add" onSubmit={add}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Pega un enlace de YouTube"
          inputMode="url"
          aria-label="Enlace de YouTube"
        />
        <button type="submit" disabled={adding}>
          {adding ? "…" : "Añadir"}
        </button>
      </form>
      {addError && <p className="error">{addError}</p>}

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab on" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label} <span className="count">{lists[t.id].length}</span>
          </button>
        ))}
      </nav>

      {lib.error && <p className="error">Sin conexión con el servidor ({lib.error}). Se reintenta solo.</p>}
      {!lib.loaded && !lib.error && <p className="muted">Cargando…</p>}
      {lib.loaded && items.length === 0 && <p className="muted">{EMPTY[tab]}</p>}

      <ul className="list">
        {items.map((v) => (
          <Row key={v.videoId} v={v} tab={tab} lib={lib} />
        ))}
      </ul>
    </main>
  );
}

const EMPTY: Record<Tab, string> = {
  queue: "Nada pendiente. Pega un enlace arriba, o comparte uno desde el APK.",
  progress: "Ningún vídeo a medias.",
  watched: "Aún no has terminado ningún vídeo.",
};

function Row({ v, tab, lib }: { v: Video; tab: Tab; lib: ReturnType<typeof useLibrary> }) {
  const pct = v.durationSec ? Math.min(100, (v.positionSec / v.durationSec) * 100) : 0;
  const now = () => Date.now();
  return (
    <li className="row">
      <Link href={`/watch/${v.videoId}`} className="thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(v.videoId)} alt="" loading="lazy" width={160} height={90} />
        {pct > 0 && !v.watched && (
          <span className="bar">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </Link>
      <div className="meta">
        <Link href={`/watch/${v.videoId}`} className="title">
          {v.title || v.videoId}
        </Link>
        <span className="sub">
          {v.channel}
          {v.positionSec > 0 && !v.watched && ` · ${fmtTime(v.positionSec)}`}
          {v.durationSec > 0 && ` / ${fmtTime(v.durationSec)}`}
        </span>
        <span className="actions">
          {tab === "queue" && (
            <button onClick={() => lib.change({ videoId: v.videoId, queued: false, queuedAt: now() })}>
              Quitar
            </button>
          )}
          {tab !== "watched" && (
            <button
              onClick={() =>
                lib.change({
                  videoId: v.videoId,
                  watched: true,
                  watchedAt: now(),
                  queued: false,
                  queuedAt: now(),
                })
              }
            >
              Marcar visto
            </button>
          )}
          {tab === "watched" && (
            <button onClick={() => lib.change({ videoId: v.videoId, watched: false, watchedAt: now() })}>
              Desmarcar
            </button>
          )}
          {tab !== "queue" && !v.queued && (
            <button onClick={() => lib.change({ videoId: v.videoId, queued: true, queuedAt: now() })}>
              Por ver
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

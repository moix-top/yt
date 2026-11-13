"use client";

// Descargar listas de YouTube Music (o YouTube) a disco, en MP3 o MP4 con la
// calidad elegida. Solo en local: lo hace yt-dlp en el propio ordenador.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Job } from "@/lib/downloads/jobs";
import { DEFAULT_QUALITY, QUALITIES, downloadsEnabled, type Format } from "@/lib/downloads/options";

const STATE: Record<Job["state"], string> = {
  listing: "Leyendo la lista…",
  running: "Descargando",
  done: "Terminada",
  error: "Error",
  cancelled: "Cancelada",
};

const active = (j: Job) => j.state === "listing" || j.state === "running";

export default function Descargas() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>("mp3");
  const [quality, setQuality] = useState(DEFAULT_QUALITY.mp3);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dir, setDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/downloads");
    if (r.status === 401) return void (window.location.href = "/login");
    const j = await r.json();
    if (!r.ok) return setError(j.error);
    setJobs(j.jobs);
    setDir(j.dir);
  }, []);

  // Se consulta cada segundo mientras haya algo en marcha.
  const running = jobs.some(active);
  useEffect(() => {
    if (!downloadsEnabled) return;
    void load();
    if (!running) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [load, running]);

  function pickFormat(f: Format) {
    setFormat(f);
    setQuality(DEFAULT_QUALITY[f]);
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/downloads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, format, quality }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function cancel(id: string) {
    await fetch(`/api/downloads/${id}`, { method: "DELETE" });
    void load();
  }

  async function clear() {
    await fetch("/api/downloads", { method: "DELETE" });
    void load();
  }

  return (
    <main className="shell">
      <header className="top">
        <Link href="/" className="link-muted">← Volver</Link>
      </header>
      <h2>Descargar listas</h2>

      {!downloadsEnabled ? (
        <p className="muted">Las descargas solo funcionan con la web levantada en local (<code>npm run dev</code>).</p>
      ) : (
        <>
          <p className="muted">
            Pega el enlace de una lista, un álbum o una canción de YouTube Music (o YouTube).
            {dir && <> Se guarda en <code>{dir}</code>, una carpeta por lista.</>} Si relanzas una
            lista con el mismo formato y calidad, solo baja lo que falte.
          </p>

          <form className="dl-form" onSubmit={start}>
            <div className="add">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://music.youtube.com/playlist?list=…"
                inputMode="url"
                aria-label="Enlace de la lista"
              />
              <button type="submit" disabled={sending}>
                {sending ? "…" : "Descargar"}
              </button>
            </div>
            <div className="dl-options">
              <div className="seg" role="radiogroup" aria-label="Formato">
                {(["mp3", "mp4"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={format === f}
                    className={format === f ? "on" : ""}
                    onClick={() => pickFormat(f)}
                  >
                    {f === "mp3" ? "MP3 (audio)" : "MP4 (vídeo)"}
                  </button>
                ))}
              </div>
              <select value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="Calidad">
                {QUALITIES[format].map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>
          </form>
          {error && <p className="error">{error}</p>}

          {jobs.some((j) => !active(j)) && (
            <p>
              <button onClick={() => void clear()}>Limpiar terminadas</button>
            </p>
          )}

          <ul className="list dl-jobs">
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} onCancel={() => void cancel(j.id)} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function JobCard({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const finished = job.items.filter((i) => i.status === "done" || i.status === "skipped").length;
  const failed = job.items.filter((i) => i.status === "error").length;
  const quality = QUALITIES[job.format].find((q) => q.id === job.quality)?.label ?? job.quality;
  return (
    <li className="token">
      <div className="dl-head">
        <div className="meta">
          <span className="title">{job.title}</span>
          <span className="sub">
            {job.format.toUpperCase()} · {quality} · {STATE[job.state]}
            {job.items.length > 0 && ` · ${finished}/${job.items.length}`}
            {failed > 0 && ` · ${failed} con error`}
          </span>
        </div>
        {active(job) && <button onClick={onCancel}>Cancelar</button>}
      </div>
      {job.error && <p className="error">{job.error}</p>}
      {job.items.length > 0 && (
        <details open={job.state === "running"}>
          <summary className="sub">Pistas</summary>
          <ol className="dl-items">
            {job.items.map((i) => (
              <li key={i.id} className={`dl-item ${i.status}`}>
                <span className="dl-name">{i.title}</span>
                <span className="sub">
                  {i.status === "downloading" && `${Math.round(i.pct)} %`}
                  {i.status === "done" && "✓"}
                  {i.status === "skipped" && "ya estaba"}
                  {i.status === "error" && <span className="error" title={i.error}>error</span>}
                </span>
                {i.status === "downloading" && (
                  <span className="dl-bar">
                    <span style={{ width: `${i.pct}%` }} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

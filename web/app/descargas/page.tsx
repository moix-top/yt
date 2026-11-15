"use client";

// Descargar listas de YouTube Music (o YouTube) a disco, en MP3 o MP4 con la
// calidad elegida. Solo en local: lo hace yt-dlp en el propio ordenador.
//
// Dos modos: sincronizar una lista con una carpeta (se guarda y se relanza con
// un botón; solo baja lo que falte) y la descarga suelta de toda la vida.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Job } from "@/lib/downloads/jobs";
import type { Sync } from "@/lib/downloads/syncs";
import { DEFAULT_QUALITY, QUALITIES, downloadsEnabled, type Format } from "@/lib/downloads/options";

const STATE: Record<Job["state"], string> = {
  listing: "Leyendo la lista…",
  running: "Descargando",
  done: "Terminada",
  error: "Error",
  cancelled: "Cancelada",
};

const active = (j: Job) => j.state === "listing" || j.state === "running";

const fmtDate = (ms: number) => new Date(ms).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });

type SyncRow = Sync & { jobId: string | null };

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j;
}

export default function Descargas() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>("mp3");
  const [quality, setQuality] = useState(DEFAULT_QUALITY.mp3);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [syncs, setSyncs] = useState<SyncRow[]>([]);
  const [syncUrl, setSyncUrl] = useState("");
  const [syncDir, setSyncDir] = useState("");
  const [syncFormat, setSyncFormat] = useState<Format>("mp3");
  const [syncQuality, setSyncQuality] = useState(DEFAULT_QUALITY.mp3);
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
    const rs = await fetch("/api/syncs");
    if (rs.ok) setSyncs((await rs.json()).syncs);
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

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await load();
  }

  async function addSync(e: React.FormEvent) {
    e.preventDefault();
    if (!syncUrl.trim() || !syncDir.trim()) return;
    setSending(true);
    await act(async () => {
      await send("/api/syncs", "POST", { url: syncUrl, dir: syncDir, format: syncFormat, quality: syncQuality });
      setSyncUrl("");
      setSyncDir("");
    });
    setSending(false);
  }

  const runSync = (id: string) => act(() => send(`/api/syncs/${id}`, "POST"));
  const runAll = () => act(() => Promise.all(syncs.filter((s) => !s.jobId).map((s) => send(`/api/syncs/${s.id}`, "POST"))));
  const forgetSync = (id: string) => act(() => send(`/api/syncs/${id}`, "DELETE"));

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
      {error && <p className="error">{error}</p>}

      {!downloadsEnabled ? (
        <p className="muted">Las descargas solo funcionan con la web levantada en local (<code>npm run dev</code>).</p>
      ) : (
        <>
          <section>
            <h3>Sincronizar una lista con una carpeta</h3>
            <p className="muted">
              Se guarda y la vuelves a sincronizar con un botón: solo baja las canciones que no estén ya
              en la carpeta, y nunca borra nada aunque las quites de la lista.
            </p>
            <form className="dl-form" onSubmit={addSync}>
              <div className="add">
                <input
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  placeholder="Enlace de la lista de YouTube Music"
                  inputMode="url"
                  aria-label="Enlace de la lista a sincronizar"
                />
              </div>
              <div className="add">
                <input
                  value={syncDir}
                  onChange={(e) => setSyncDir(e.target.value)}
                  placeholder="Carpeta, p. ej. ~/Música/Favoritas"
                  aria-label="Carpeta local"
                />
                <button type="submit" disabled={sending}>
                  {sending ? "…" : "Guardar y sincronizar"}
                </button>
              </div>
              <FormatPicker
                format={syncFormat}
                quality={syncQuality}
                onFormat={(f) => {
                  setSyncFormat(f);
                  setSyncQuality(DEFAULT_QUALITY[f]);
                }}
                onQuality={setSyncQuality}
              />
            </form>

            {syncs.length > 1 && (
              <p>
                <button onClick={() => void runAll()}>Sincronizar todas</button>
              </p>
            )}
            <ul className="list dl-jobs">
              {syncs.map((s) => (
                <li key={s.id} className="token">
                  <div className="dl-head">
                    <div className="meta">
                      <span className="title">{s.title}</span>
                      <span className="sub">
                        <code>{s.dir}</code> · {s.format.toUpperCase()} ·{" "}
                        {QUALITIES[s.format].find((q) => q.id === s.quality)?.label ?? s.quality}
                      </span>
                      <span className="sub">
                        {s.jobId
                          ? "Sincronizando… (progreso abajo)"
                          : s.lastRunAt
                            ? `Última: ${fmtDate(s.lastRunAt)} · ${s.lastResult}`
                            : "Sin sincronizar todavía"}
                      </span>
                    </div>
                    <span className="actions">
                      <button onClick={() => void runSync(s.id)} disabled={Boolean(s.jobId)}>
                        Sincronizar
                      </button>
                      <button onClick={() => void forgetSync(s.id)} disabled={Boolean(s.jobId)} title="La carpeta y sus archivos no se tocan">
                        Quitar
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <h3>Descarga suelta</h3>
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
            <FormatPicker format={format} quality={quality} onFormat={pickFormat} onQuality={setQuality} />
          </form>

          {jobs.length > 0 && <h3>En curso y terminadas</h3>}
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

function FormatPicker(props: {
  format: Format;
  quality: string;
  onFormat: (f: Format) => void;
  onQuality: (q: string) => void;
}) {
  return (
    <div className="dl-options">
      <div className="seg" role="radiogroup" aria-label="Formato">
        {(["mp3", "mp4"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={props.format === f}
            className={props.format === f ? "on" : ""}
            onClick={() => props.onFormat(f)}
          >
            {f === "mp3" ? "MP3 (audio)" : "MP4 (vídeo)"}
          </button>
        ))}
      </div>
      <select value={props.quality} onChange={(e) => props.onQuality(e.target.value)} aria-label="Calidad">
        {QUALITIES[props.format].map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
    </div>
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

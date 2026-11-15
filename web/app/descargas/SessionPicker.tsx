"use client";

// Elegir de qué navegador y perfil saca yt-dlp la sesión de YouTube, para
// «Me gusta» y las listas privadas. Ver lib/downloads/cookies.ts.

import { useCallback, useEffect, useState } from "react";
import type { Browser, CookieChoice } from "@/lib/downloads/cookies";

const NONE = "";

export default function SessionPicker() {
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const [saved, setSaved] = useState<CookieChoice | null>(null);
  const [fromEnv, setFromEnv] = useState(false);
  const [browser, setBrowser] = useState(NONE);
  const [profile, setProfile] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/cookies");
    if (!r.ok) return;
    const j = (await r.json()) as { browsers: Browser[]; choice: CookieChoice | null; fromEnv: boolean };
    setBrowsers(j.browsers);
    setSaved(j.choice);
    setFromEnv(j.fromEnv);
    setBrowser(j.choice?.browser ?? NONE);
    setProfile(j.choice?.profile ?? "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const profiles = browsers.find((b) => b.id === browser)?.profiles ?? [];
  const choice = browser ? { browser, profile } : null;
  const dirty = (choice?.browser ?? "") !== (saved?.browser ?? "") || (choice?.profile ?? "") !== (saved?.profile ?? "");

  function pickBrowser(id: string) {
    setBrowser(id);
    setProfile(browsers.find((b) => b.id === id)?.profiles[0]?.path ?? "");
    setStatus(null);
  }

  async function call(method: "PUT" | "POST") {
    setBusy(true);
    setStatus(method === "POST" ? { ok: true, text: "Probando con «Me gusta»…" } : null);
    try {
      const r = await fetch("/api/cookies", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(choice),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      if (method === "PUT") {
        setStatus({ ok: true, text: choice ? "Guardado." : "Guardado: no se usará ninguna sesión." });
        await load();
      } else if ("count" in j) {
        setStatus({ ok: true, text: `Funciona: se ven ${j.count} canciones en «Me gusta».` });
      } else {
        setStatus({ ok: false, text: `Con este perfil no se ve «Me gusta»: ${j.error}` });
      }
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3>Sesión de YouTube</h3>
      <p className="muted">
        Para «Me gusta» y las listas privadas hace falta tu sesión: elige el navegador y el perfil donde
        tengas YouTube iniciado. Solo se usa con las listas que sin sesión no se ven, y las cookies no
        salen de este ordenador.
        {fromEnv && " Ahora mismo vale la variable YTDLP_COOKIES_FROM_BROWSER de .env.local."}
      </p>
      <div className="dl-options">
        <select value={browser} onChange={(e) => pickBrowser(e.target.value)} aria-label="Navegador">
          <option value={NONE}>No usar sesión</option>
          {browsers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        {browser && (
          <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Perfil">
            {profiles.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {browser && (
          <button type="button" onClick={() => void call("POST")} disabled={busy}>
            Probar
          </button>
        )}
        <button type="button" onClick={() => void call("PUT")} disabled={busy || !dirty}>
          Guardar
        </button>
      </div>
      {status && <p className={status.ok ? "muted" : "error"}>{status.text}</p>}
    </section>
  );
}

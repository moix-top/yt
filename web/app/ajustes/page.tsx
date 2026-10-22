"use client";

// Vincular el APK. Se crea un token, se copia una vez en el móvil
// (Ajustes → Sincronización yt.moix.top) y aquí se puede revocar.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SyncToken } from "@/lib/types";

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "nunca";

export default function Ajustes() {
  const [tokens, setTokens] = useState<SyncToken[]>([]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/tokens");
    if (r.status === 401) return void (window.location.href = "/login");
    const j = await r.json();
    if (r.ok) setTokens(j.tokens);
    else setError(j.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await fetch("/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const j = await r.json();
    if (!r.ok) return setError(j.error);
    setFresh(j.token);
    setLabel("");
    void load();
  }

  async function revoke(id: string) {
    const r = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    if (!r.ok) setError((await r.json()).error);
    void load();
  }

  return (
    <main className="shell">
      <header className="top">
        <Link href="/" className="link-muted">← Volver</Link>
        <a href="/api/auth/signout" className="link-muted">Salir</a>
      </header>
      <h2>Dispositivos</h2>
      <p className="muted">
        Para sincronizar el APK, crea un token y pégalo en la app: <em>Ajustes → Sincronización
        yt.moix.top</em>. Cada token da acceso completo a tu lista; si pierdes el móvil, revócalo.
      </p>
      <p className="muted">
        <a href="https://github.com/moix-top/yt/releases/latest" target="_blank" rel="noopener noreferrer">
          Descargar la última versión del APK
        </a>
      </p>

      <form className="add" onSubmit={create}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nombre (p. ej. Pixel)" />
        <button type="submit">Crear token</button>
      </form>
      {error && <p className="error">{error}</p>}

      {fresh && (
        <div className="token">
          <p>Cópialo ahora: no se vuelve a mostrar.</p>
          <code>{fresh}</code>
          <button onClick={() => void navigator.clipboard.writeText(fresh)}>Copiar</button>
        </div>
      )}

      <ul className="list">
        {tokens.map((t) => (
          <li key={t.id} className="row token-row">
            <div className="meta">
              <span className="title">{t.label}</span>
              <span className="sub">
                Creado {fmtDate(t.createdAt)} · último uso {fmtDate(t.lastUsedAt)}
              </span>
            </div>
            <button onClick={() => void revoke(t.id)}>Revocar</button>
          </li>
        ))}
      </ul>
    </main>
  );
}

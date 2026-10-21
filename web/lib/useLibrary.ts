"use client";

// Estado de la biblioteca en el navegador. La web es un cliente más de
// /api/sync, exactamente igual que el APK: aplica los cambios en local al
// momento (optimista), los encola y los manda en el siguiente ciclo. Así hay un
// solo camino de escritura y lo que se prueba en la web vale para el móvil.

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyVideo, mergeVideo } from "@/lib/merge";
import type { SyncResponse, Video, VideoPatch } from "@/lib/types";

// Con la pestaña visible; oculta no se sondea (se sincroniza al volver).
const POLL_MS = 20_000;

export interface Library {
  videos: Map<string, Video>;
  loaded: boolean;
  error: string | null;
  change: (patch: VideoPatch) => void;
  /** Envía lo pendiente aunque la página se esté cerrando. */
  flush: () => void;
}

export function useLibrary(): Library {
  const [videos, setVideos] = useState<Map<string, Video>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const since = useRef(0);
  const pending = useRef<VideoPatch[]>([]);
  const busy = useRef(false);
  const again = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    const changes = pending.current;
    pending.current = [];
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ since: since.current, changes }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as SyncResponse;
      since.current = data.now;
      setVideos((prev) => {
        const next = new Map(prev);
        for (const v of data.videos) {
          // Lo del servidor se fusiona con lo local por reloj: un cambio hecho
          // aquí mientras la petición viajaba no se pierde.
          const local = next.get(v.videoId);
          next.set(v.videoId, local ? mergeVideo(v, local, v.updatedAt) : v);
        }
        return next;
      });
      setLoaded(true);
      setError(null);
    } catch (e) {
      // Se reintentan en el siguiente ciclo, delante de lo nuevo.
      pending.current = [...changes, ...pending.current];
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void run();
      }
    }
  }, []);

  const change = useCallback(
    (patch: VideoPatch) => {
      setVideos((prev) => {
        const next = new Map(prev);
        const base = next.get(patch.videoId) ?? emptyVideo(patch.videoId);
        next.set(patch.videoId, mergeVideo(base, patch, base.updatedAt));
        return next;
      });
      pending.current.push(patch);
      void run();
    },
    [run],
  );

  const flush = useCallback(() => {
    if (!pending.current.length) return;
    const body = JSON.stringify({ since: since.current, changes: pending.current });
    // sendBeacon sobrevive al cierre de la pestaña; fetch no.
    if (navigator.sendBeacon(
      "/api/sync",
      new Blob([body], { type: "application/json" }),
    )) pending.current = [];
  }, []);

  useEffect(() => {
    void run();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
      else flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", flush);
    };
  }, [run, flush]);

  return { videos, loaded, error, change, flush };
}

export const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

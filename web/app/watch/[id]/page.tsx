"use client";

// Reproductor. Usa el embed oficial (IFrame API) con youtube-nocookie y sin
// sugerencias en lo posible: rel=0 limita el final a vídeos del mismo canal, y
// además se tapa la pantalla final con nuestro propio aviso.
//
// La posición se guarda: cada 5 s mientras suena, al pausar, al buscar y al
// salir de la página. Al terminar se marca visto, se saca de "Por ver" y la
// posición vuelve a 0 (la próxima vez empieza desde el principio, como NewPipe).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtTime, useLibrary } from "@/lib/useLibrary";
import { isVideoId } from "@/lib/merge";

const SAVE_EVERY_MS = 5_000;

// Tipos mínimos de la IFrame API: solo lo que se usa.
interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getVideoData(): { title?: string; author?: string };
  destroy(): void;
}
declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector("script[data-yt-api]")) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.dataset.ytApi = "1";
      document.head.appendChild(s);
    }
  });
}

export default function Watch({ params }: { params: { id: string } }) {
  const id = params.id;
  const lib = useLibrary();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ended, setEnded] = useState(false);
  const started = useRef(false);
  // El callback del player se crea una vez; lee la librería por ref.
  const libRef = useRef(lib);
  libRef.current = lib;

  const video = lib.videos.get(id);

  useEffect(() => {
    // Se espera a la primera sincronización para conocer el segundo de inicio.
    if (!lib.loaded || started.current || !isVideoId(id) || !host.current) return;
    started.current = true;
    const start = Math.floor(lib.videos.get(id)?.positionSec ?? 0);
    let timer: ReturnType<typeof setInterval> | undefined;

    const save = () => {
      const p = player.current;
      if (!p) return;
      const t = p.getCurrentTime();
      const d = p.getDuration();
      const data = p.getVideoData();
      libRef.current.change({
        videoId: id,
        positionSec: Math.floor(t),
        positionAt: Date.now(),
        ...(d > 0 ? { durationSec: Math.round(d) } : {}),
        ...(data.title ? { title: data.title } : {}),
        ...(data.author ? { channel: data.author } : {}),
      });
    };

    void loadApi().then(() => {
      if (!host.current || !window.YT) return;
      player.current = new window.YT.Player(host.current, {
        videoId: id,
        host: "https://www.youtube-nocookie.com",
        playerVars: { start, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3 },
        events: {
          onStateChange: (e: { data: number }) => {
            const S = window.YT!.PlayerState;
            clearInterval(timer);
            if (e.data === S.PLAYING) {
              setEnded(false);
              timer = setInterval(save, SAVE_EVERY_MS);
            } else if (e.data === S.PAUSED) {
              save();
            } else if (e.data === S.ENDED) {
              const now = Date.now();
              libRef.current.change({
                videoId: id,
                positionSec: 0,
                positionAt: now,
                watched: true,
                watchedAt: now,
                queued: false,
                queuedAt: now,
              });
              setEnded(true);
            }
          },
        },
      });
    });

    const onHide = () => {
      if (document.visibilityState === "hidden") {
        save();
        libRef.current.flush();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      save();
      player.current?.destroy();
      player.current = null;
    };
    // `lib.videos` no va en las dependencias aposta: el player se crea UNA vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.loaded, id]);

  if (!isVideoId(id)) return <main className="shell"><p className="error">Vídeo no válido.</p></main>;

  return (
    <main className="shell">
      <header className="top">
        <Link href="/" className="link-muted">← Volver</Link>
      </header>
      <div className="player">
        <div ref={host} />
        {ended && (
          <div className="ended">
            <p>Terminado y marcado como visto.</p>
            <Link href="/" className="btn">Volver a la lista</Link>
          </div>
        )}
      </div>
      <h2 className="watch-title">{video?.title || "…"}</h2>
      <p className="muted">
        {video?.channel}
        {video && video.positionSec > 0 && !ended && ` · continúa en ${fmtTime(video.positionSec)}`}
      </p>
    </main>
  );
}

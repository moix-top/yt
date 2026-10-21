// Fusión de cambios. Lógica pura: sin red ni base de datos, para poder testear
// todos los casos de conflicto sin montar nada.

import type { Video, VideoPatch } from "@/lib/types";
import { httpError } from "@/lib/http";

// Los ids de YouTube son 11 caracteres de este alfabeto. Validarlo aquí impide
// que un cliente meta en la sk algo con '#' u otra cosa que rompa el esquema.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const isVideoId = (id: unknown): id is string => typeof id === "string" && VIDEO_ID.test(id);

/** Extrae el id de una URL de YouTube (o lo devuelve si ya es un id). */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (VIDEO_ID.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v");
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    if (!id && m) id = m[1];
  }
  return isVideoId(id) ? id : null;
}

export function emptyVideo(videoId: string): Video {
  return {
    videoId,
    title: "",
    channel: "",
    durationSec: 0,
    positionSec: 0,
    positionAt: 0,
    queued: false,
    queuedAt: 0,
    watched: false,
    watchedAt: 0,
    updatedAt: 0,
  };
}

const num = (v: unknown, field: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw httpError(400, `Campo inválido: ${field}`);
  }
  return v;
};
const bool = (v: unknown, field: string): boolean => {
  if (typeof v !== "boolean") throw httpError(400, `Campo inválido: ${field}`);
  return v;
};
const text = (v: unknown, field: string, max: number): string => {
  if (typeof v !== "string") throw httpError(400, `Campo inválido: ${field}`);
  return v.slice(0, max);
};

/**
 * Valida un parche de cliente y lo reduce a los campos conocidos. Un grupo
 * (valor + reloj) solo se acepta completo: un valor sin reloj no se puede
 * ordenar frente a otros cambios.
 */
export function sanitizePatch(raw: unknown): VideoPatch {
  if (!raw || typeof raw !== "object") throw httpError(400, "Cambio inválido");
  const r = raw as Record<string, unknown>;
  if (!isVideoId(r.videoId)) throw httpError(400, "videoId inválido");
  const p: VideoPatch = { videoId: r.videoId };

  if (r.title !== undefined) p.title = text(r.title, "title", 300);
  if (r.channel !== undefined) p.channel = text(r.channel, "channel", 200);
  if (r.durationSec !== undefined) p.durationSec = num(r.durationSec, "durationSec");

  const group = (value: string, clock: string) => {
    const has = r[value] !== undefined;
    if (has !== (r[clock] !== undefined)) throw httpError(400, `${value} y ${clock} van juntos`);
    return has;
  };
  if (group("positionSec", "positionAt")) {
    p.positionSec = num(r.positionSec, "positionSec");
    p.positionAt = num(r.positionAt, "positionAt");
  }
  if (group("queued", "queuedAt")) {
    p.queued = bool(r.queued, "queued");
    p.queuedAt = num(r.queuedAt, "queuedAt");
  }
  if (group("watched", "watchedAt")) {
    p.watched = bool(r.watched, "watched");
    p.watchedAt = num(r.watchedAt, "watchedAt");
  }
  return p;
}

/**
 * Aplica un parche sobre el estado guardado. Cada grupo gana por su reloj; en
 * empate se queda lo guardado, así reenviar el mismo cambio es idempotente.
 * Los metadatos no tienen reloj: un valor no vacío sustituye a uno vacío, y si
 * ambos existen se queda el nuevo (corrigen títulos, no los borran).
 */
export function mergeVideo(current: Video | null, patch: VideoPatch, now: number): Video {
  const v: Video = { ...(current ?? emptyVideo(patch.videoId)) };

  if (patch.title) v.title = patch.title;
  if (patch.channel) v.channel = patch.channel;
  if (patch.durationSec) v.durationSec = patch.durationSec;

  if (patch.positionAt !== undefined && patch.positionAt > v.positionAt) {
    v.positionSec = patch.positionSec!;
    v.positionAt = patch.positionAt;
  }
  if (patch.queuedAt !== undefined && patch.queuedAt > v.queuedAt) {
    v.queued = patch.queued!;
    v.queuedAt = patch.queuedAt;
  }
  if (patch.watchedAt !== undefined && patch.watchedAt > v.watchedAt) {
    v.watched = patch.watched!;
    v.watchedAt = patch.watchedAt;
  }

  v.updatedAt = now;
  return v;
}

/** ¿El parche cambia algo? Si no, no se reescribe el ítem ni se mueve su cursor. */
export function sameVideo(a: Video, b: Video): boolean {
  return (Object.keys(a) as (keyof Video)[]).every((k) => k === "updatedAt" || a[k] === b[k]);
}

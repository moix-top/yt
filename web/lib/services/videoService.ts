// Única vía de acceso a los datos. Mismas invariantes que wealthService:
//
//   1. La pk se calcula aquí, a partir del userId que entrega lib/auth.ts (sesión)
//      o resolveToken (APK). Ninguna función acepta una pk de fuera.
//   2. Toda lectura va acotada a esa pk. Nunca Scan.
//   3. Toda escritura lleva esa pk en la clave.
//   4. Los ítems se construyen campo a campo (toItem); nada de spread del body.

import { createHash, randomBytes } from "node:crypto";
import { getStore, tokenPk, tokenSk, userPk, videoSk, type Item } from "@/lib/dynamo";
import { httpError } from "@/lib/http";
import { mergeVideo, sameVideo, sanitizePatch } from "@/lib/merge";
import type { SyncResponse, SyncToken, Video, VideoPatch } from "@/lib/types";

// Un usuario normal no se acerca, pero acota lo que un cliente roto puede mandar
// en una sola petición.
const MAX_CHANGES = 500;
const MAX_TOKENS = 10;

function toItem(userId: string, v: Video): Item {
  return {
    pk: userPk(userId),
    sk: videoSk(v.videoId),
    videoId: v.videoId,
    title: v.title,
    channel: v.channel,
    durationSec: v.durationSec,
    positionSec: v.positionSec,
    positionAt: v.positionAt,
    queued: v.queued,
    queuedAt: v.queuedAt,
    watched: v.watched,
    watchedAt: v.watchedAt,
    updatedAt: v.updatedAt,
  };
}

function fromItem(i: Item): Video {
  return {
    videoId: String(i.videoId),
    title: String(i.title ?? ""),
    channel: String(i.channel ?? ""),
    durationSec: Number(i.durationSec ?? 0),
    positionSec: Number(i.positionSec ?? 0),
    positionAt: Number(i.positionAt ?? 0),
    queued: i.queued === true,
    queuedAt: Number(i.queuedAt ?? 0),
    watched: i.watched === true,
    watchedAt: Number(i.watchedAt ?? 0),
    updatedAt: Number(i.updatedAt ?? 0),
  };
}

export async function listVideos(userId: string): Promise<Video[]> {
  const items = await getStore().query(userPk(userId), "VIDEO#");
  return items.map(fromItem);
}

export async function getVideo(userId: string, videoId: string): Promise<Video | null> {
  const i = await getStore().get(userPk(userId), videoSk(videoId));
  return i ? fromItem(i) : null;
}

/** Aplica parches ya validados. Devuelve los vídeos que han cambiado de verdad. */
export async function applyChanges(
  userId: string,
  patches: VideoPatch[],
  now = Date.now(),
): Promise<Video[]> {
  const store = getStore();
  const changed: Video[] = [];
  for (const p of patches) {
    const current = await getVideo(userId, p.videoId);
    const next = mergeVideo(current, p, now);
    if (current && sameVideo(current, next)) continue;
    await store.put(toItem(userId, next));
    changed.push(next);
  }
  return changed;
}

/**
 * Un ciclo de sincronización: primero se aplica lo que trae el cliente y luego
 * se le devuelve todo lo que ha cambiado desde su cursor (incluido lo suyo, ya
 * fusionado: así recibe el resultado si perdió algún conflicto).
 */
export async function sync(userId: string, body: unknown): Promise<SyncResponse> {
  const b = (body ?? {}) as { since?: unknown; changes?: unknown };
  const since = typeof b.since === "number" && b.since >= 0 ? b.since : 0;
  const raw = Array.isArray(b.changes) ? b.changes : [];
  if (raw.length > MAX_CHANGES) throw httpError(413, `Máximo ${MAX_CHANGES} cambios por petición`);

  const now = Date.now();
  await applyChanges(userId, raw.map(sanitizePatch), now);
  const videos = (await listVideos(userId)).filter((v) => v.updatedAt > since);
  return { now, videos };
}

// ── Tokens de sincronización ─────────────────────────────────────────────────
//
// El APK no usa Google Sign-In: eso exige Google Play Services y NewPipe existe
// precisamente para no depender de ellos. En su lugar, la web (con sesión de
// Google) emite un token largo y aleatorio que se pega una vez en el móvil.
// Solo se guarda su SHA-256: si la tabla se filtra, los tokens no sirven.

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function createToken(userId: string, label: string): Promise<string> {
  const existing = await listTokens(userId);
  if (existing.length >= MAX_TOKENS) throw httpError(409, `Máximo ${MAX_TOKENS} dispositivos`);

  const token = `yt_${randomBytes(32).toString("base64url")}`;
  const hash = hashToken(token);
  const createdAt = Date.now();
  const cleanLabel = label.trim().slice(0, 60) || "Dispositivo";
  const store = getStore();
  // Primero el índice inverso: si falla lo segundo, queda un token que no sale
  // en la lista; al revés quedaría uno en la lista que no funciona.
  await store.put({ pk: tokenPk(hash), sk: "TOKEN", userId });
  await store.put({
    pk: userPk(userId),
    sk: tokenSk(hash),
    label: cleanLabel,
    createdAt,
    lastUsedAt: null,
  });
  return token;
}

export async function listTokens(userId: string): Promise<SyncToken[]> {
  const items = await getStore().query(userPk(userId), "TOKEN#");
  return items.map((i) => ({
    id: i.sk.slice("TOKEN#".length, "TOKEN#".length + 12),
    label: String(i.label ?? ""),
    createdAt: Number(i.createdAt ?? 0),
    lastUsedAt: i.lastUsedAt == null ? null : Number(i.lastUsedAt),
  }));
}

/** Revoca por el prefijo que muestra la lista, buscándolo DENTRO de la partición propia. */
export async function revokeToken(userId: string, id: string): Promise<void> {
  const items = await getStore().query(userPk(userId), "TOKEN#");
  const hit = items.find((i) => i.sk.slice("TOKEN#".length).startsWith(id) && id.length >= 12);
  if (!hit) throw httpError(404, "Token no encontrado");
  const hash = hit.sk.slice("TOKEN#".length);
  await getStore().delete(tokenPk(hash), "TOKEN");
  await getStore().delete(userPk(userId), hit.sk);
}

/** Token → userId, o null. Actualiza lastUsedAt como mucho una vez por hora. */
export async function resolveToken(token: string): Promise<string | null> {
  if (!token.startsWith("yt_")) return null;
  const hash = hashToken(token);
  const store = getStore();
  const idx = await store.get(tokenPk(hash), "TOKEN");
  if (!idx || typeof idx.userId !== "string") return null;
  const userId = idx.userId;

  const meta = await store.get(userPk(userId), tokenSk(hash));
  if (!meta) return null; // revocado a medias: no vale
  const now = Date.now();
  if (!meta.lastUsedAt || now - Number(meta.lastUsedAt) > 3600_000) {
    await store.put({ ...meta, lastUsedAt: now });
  }
  return userId;
}

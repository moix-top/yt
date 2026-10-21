// Modelo compartido por la web y por el APK (la API de /api/sync habla esto).
//
// Un vídeo es un único registro por usuario y por id de YouTube. Lo que la web y
// el móvil pueden cambiar a la vez son tres cosas independientes, y cada una
// lleva su propio reloj para fusionarse por separado ("gana el último cambio"):
//
//   posición  → positionSec  + positionAt
//   por ver   → queued       + queuedAt
//   visto     → watched      + watchedAt
//
// Así, marcar un vídeo "por ver" en la web mientras el móvil guarda su posición
// no se pisan: tocan relojes distintos.
//
// Los relojes son epoch en ms del dispositivo que hizo el cambio. `updatedAt` es
// otra cosa: lo pone el SERVIDOR al guardar y sirve de cursor para "dame lo que
// ha cambiado desde X"; si viniera del cliente, un móvil con la hora mal se
// saltaría cambios.

export interface Video {
  videoId: string;
  title: string;
  channel: string;
  /** 0 si aún no se conoce (la web lo averigua al reproducir). */
  durationSec: number;

  positionSec: number;
  positionAt: number;

  queued: boolean;
  queuedAt: number;

  watched: boolean;
  watchedAt: number;

  /** Hora del servidor del último guardado. Cursor de sincronización. */
  updatedAt: number;
}

/** Lo que un cliente puede mandar: el id y cualquier subconjunto de campos. */
export type VideoPatch = { videoId: string } & Partial<Omit<Video, "videoId" | "updatedAt">>;

export interface SyncRequest {
  /** `now` de la respuesta anterior; 0 la primera vez. */
  since: number;
  changes: VideoPatch[];
}

export interface SyncResponse {
  now: number;
  videos: Video[];
}

export interface SyncToken {
  /** Primeros caracteres del hash, para reconocerlo en la lista sin exponerlo. */
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

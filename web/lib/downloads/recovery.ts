// Que un apagón a mitad de una sincronización no deje la carpeta corrupta, y que
// la siguiente pasada siga por donde iba.
//
// - yt-dlp trabaja en `.yt-sync-tmp/` (misma carpeta, mismo disco) y solo mueve
//   a su sitio el archivo terminado: en la carpeta nunca hay nada a medias.
// - Cada archivo terminado se fuerza a disco (fsync) antes de anotarlo en el
//   índice, y el índice se escribe de forma atómica (temporal + rename).
// - `.yt-sync-run.json` marca una pasada en curso. Si al empezar sigue ahí, la
//   anterior se cortó: se revisan a fondo los archivos de esa pasada (en un USB
//   FAT un corte puede estropear archivos ya escritos), se apartan restos y
//   dañados a `.yt-sync-recuperados/` y se adoptan los sanos que falten del
//   índice. Nunca se borra nada que no sea de la carpeta temporal.

import { spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { STAGING, type Format } from "./options";

export const QUARANTINE = ".yt-sync-recuperados";
const INDEX = ".yt-sync.json";
const JOURNAL = ".yt-sync-run.json";

/** id de vídeo → archivo (relativo a la carpeta) y cuándo se anotó. */
export type Index = Record<string, { file: string; at: number }>;

function fsyncPath(p: string) {
  const fd = openSync(p, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Escribe JSON de forma que un corte deja el archivo viejo o el nuevo, nunca uno a medias. */
export function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  fsyncPath(tmp);
  renameSync(tmp, file);
}

/** Fuerza a disco un archivo recién terminado (USB con caché de escritura). */
export function flushFile(file: string) {
  try {
    fsyncPath(file);
  } catch {
    // Si no se puede abrir, la verificación de la próxima pasada lo detectará.
  }
}

export function readIndex(dir: string): Index {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, INDEX), "utf8")) as Record<string, string | Index[string]>;
    // Formato antiguo: {id: "archivo"}.
    return Object.fromEntries(
      Object.entries(raw).map(([id, v]) => [id, typeof v === "string" ? { file: v, at: 0 } : v]),
    );
  } catch {
    return {};
  }
}

export const saveIndex = (dir: string, index: Index) => writeJsonAtomic(path.join(dir, INDEX), index);

function exec(cmd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: 1, out, err: e.message }));
    p.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
}

/**
 * Decodifica el audio entero. Dañado si hay cualquier error de lectura o de
 * datos, o si dura menos de lo que dice su cabecera: un MP3 cortado a medias
 * se decodifica sin errores, simplemente acaba antes.
 */
export async function isIntact(file: string): Promise<boolean> {
  const head = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const expected = parseFloat(head.out);
  if (head.code !== 0 || !Number.isFinite(expected)) return false;
  // Solo el audio: la carátula incrustada es otro flujo y falsea el tiempo.
  const r = await exec("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a", "-f", "null", "-", "-progress", "pipe:1"]);
  const us = [...r.out.matchAll(/out_time_us=(\d+)/g)].pop()?.[1];
  const actual = us ? Number(us) / 1e6 : 0;
  return r.code === 0 && r.err.trim() === "" && actual >= expected - Math.max(1, expected * 0.01);
}

/** id del vídeo según las etiquetas que pone yt-dlp (purl / comment). */
export async function mediaId(file: string): Promise<string | null> {
  const r = await exec("ffprobe", ["-v", "error", "-show_entries", "format_tags=purl,comment", "-of", "json", file]);
  const m = r.out.match(/[?&]v=([\w-]{11})/);
  return m ? m[1] : null;
}

function quarantine(dir: string, name: string) {
  const q = path.join(dir, QUARANTINE);
  mkdirSync(q, { recursive: true });
  let target = path.join(q, name);
  if (existsSync(target)) target = path.join(q, `${Date.now()}-${name}`);
  renameSync(path.join(dir, name), target);
}

// Restos de yt-dlp que nunca deberían quedar sueltos en la carpeta.
const LEFTOVER = /\.(part|ytdl|tmp)$|\.temp\.|\.part-Frag\d+|\.f\d+\.\w+$/;
const RAW_MEDIA = /\.(webm|webp|m4a|opus|jpg|jpeg|png|mkv)$/i;

export interface Recovery {
  index: Index;
  /** La pasada anterior se cortó y se ha hecho la revisión a fondo. */
  interrupted: boolean;
  /** Resumen legible de lo que se ha arreglado, o null si no hubo nada. */
  report: string | null;
}

/** Comprueba que se puede escribir; si no, explica por qué no. */
function assertWritable(dir: string) {
  try {
    accessSync(dir, constants.W_OK);
    const probe = path.join(dir, ".yt-sync-probe");
    writeFileSync(probe, "");
    rmSync(probe);
  } catch {
    throw new Error(
      `No se puede escribir en ${dir}. Si es un USB y se cortó la luz, probablemente el sistema lo ha montado en solo lectura por errores: hay que repararlo (fsck) y volver a conectarlo.`,
    );
  }
}

/** Deja la carpeta lista para una pasada, reparando lo que dejase una pasada cortada. */
export async function prepareFolder(dir: string, format: Format): Promise<Recovery> {
  mkdirSync(dir, { recursive: true });
  assertWritable(dir);
  rmSync(path.join(dir, STAGING), { recursive: true, force: true });

  const journal = path.join(dir, JOURNAL);
  let startedAt: number | null = null;
  try {
    startedAt = (JSON.parse(readFileSync(journal, "utf8")) as { startedAt: number }).startedAt;
  } catch {
    // Sin diario (o ilegible pero presente): ver abajo.
  }
  let interrupted = startedAt !== null || existsSync(journal);
  const index = readIndex(dir);
  const ext = `.${format}`;
  let leftovers = 0;
  let damaged = 0;
  let adopted = 0;

  const names = readdirSync(dir).filter((n) => !n.startsWith(".yt-sync"));
  const indexed = new Set(Object.values(index).map((e) => e.file));

  // Restos sueltos de la versión anterior, sin carpeta temporal.
  for (const n of names) {
    if (LEFTOVER.test(n) || (RAW_MEDIA.test(n) && !n.toLowerCase().endsWith(ext))) {
      quarantine(dir, n);
      leftovers++;
    }
  }

  // Restos a medias = hubo un corte, aunque no haya diario (versiones antiguas).
  if (leftovers) interrupted = true;

  // Lo anotado que ya no está (borrado a mano o perdido) se olvida: se volverá a bajar.
  for (const [id, e] of Object.entries(index)) if (!existsSync(path.join(dir, e.file))) delete index[id];

  if (interrupted) {
    // Lo escrito en la pasada cortada puede haberse estropeado en el disco. Sin
    // diario no se sabe qué pasada fue: se revisa todo (una vez, tras el corte).
    for (const [id, e] of Object.entries(index)) {
      if (startedAt !== null && e.at < startedAt) continue;
      if (!(await isIntact(path.join(dir, e.file)))) {
        quarantine(dir, e.file);
        delete index[id];
        damaged++;
      }
    }
  }

  // Archivos del formato de la lista que faltan del índice: si están sanos y se
  // sabe de qué vídeo son, se adoptan; si están dañados, se apartan.
  for (const n of readdirSync(dir)) {
    if (!n.toLowerCase().endsWith(ext) || indexed.has(n) || n.startsWith(".")) continue;
    const full = path.join(dir, n);
    const id = await mediaId(full);
    if (!id) continue; // No es nuestro: no se toca.
    if (await isIntact(full)) {
      index[id] = { file: n, at: Date.now() };
      adopted++;
    } else {
      quarantine(dir, n);
      damaged++;
    }
  }

  saveIndex(dir, index);
  writeJsonAtomic(journal, { startedAt: Date.now() });

  const parts: string[] = [];
  if (damaged) parts.push(`${damaged} dañadas apartadas y se vuelven a bajar`);
  if (leftovers) parts.push(`${leftovers} restos a medias apartados`);
  if (adopted) parts.push(`${adopted} recuperadas al índice`);
  const report =
    interrupted || parts.length
      ? `Recuperación${interrupted ? " tras un corte" : ""}: ${parts.join(", ") || "todo en orden"}.` +
        (damaged || leftovers ? ` Lo apartado está en ${QUARANTINE}/.` : "")
      : null;
  return { index, interrupted, report };
}

/** Fin limpio (terminada o cancelada): ya no hay pasada a medias. */
export function finishFolder(dir: string) {
  rmSync(path.join(dir, STAGING), { recursive: true, force: true });
  rmSync(path.join(dir, JOURNAL), { force: true });
}

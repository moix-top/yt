// Sincronizaciones guardadas: una lista de YouTube Music ↔ una carpeta local.
// Se lanzan a mano (botón) y solo añaden: lo que ya está en la carpeta no se
// vuelve a bajar y nunca se borra nada, aunque se quite de la lista.
//
// Se guardan en web/.data/sincronizaciones.json (fuera del repo): es una
// función solo local, igual que las descargas.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { httpError } from "@/lib/http";
import { activeJobForSync, startJob, type Job } from "./jobs";
import type { Format } from "./options";

export interface Sync {
  id: string;
  url: string;
  /** Título de la lista; se actualiza en cada pasada. */
  title: string;
  dir: string;
  format: Format;
  quality: string;
  createdAt: number;
  lastRunAt: number | null;
  /** Resumen de la última pasada, p. ej. "3 nuevas, 120 ya estaban, 1 con error". */
  lastResult: string | null;
}

const FILE = path.join(process.cwd(), ".data", "sincronizaciones.json");

function load(): Sync[] {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Sync[];
  } catch {
    return [];
  }
}

function save(syncs: Sync[]) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(syncs, null, 2));
}

/** Ruta absoluta; admite "~/Música/lista". */
export function resolveDir(input: string): string | null {
  const t = input.trim();
  const p = t === "~" || t.startsWith("~/") ? path.join(homedir(), t.slice(1)) : t;
  return path.isAbsolute(p) ? path.normalize(p) : null;
}

export function listSyncs(): (Sync & { jobId: string | null })[] {
  return load().map((s) => ({ ...s, jobId: activeJobForSync(s.id)?.id ?? null }));
}

export function createSync(url: string, dir: string, format: Format, quality: string): Sync {
  const syncs = load();
  if (syncs.some((s) => s.dir === dir)) throw httpError(409, "Esa carpeta ya está sincronizada con otra lista");
  const sync: Sync = {
    id: randomUUID(),
    url,
    title: url,
    dir,
    format,
    quality,
    createdAt: Date.now(),
    lastRunAt: null,
    lastResult: null,
  };
  save([...syncs, sync]);
  return sync;
}

/** Quita la sincronización guardada. La carpeta y sus archivos no se tocan. */
export function deleteSync(id: string): boolean {
  const syncs = load();
  const rest = syncs.filter((s) => s.id !== id);
  if (rest.length === syncs.length) return false;
  save(rest);
  return true;
}

function summary(job: Job): string {
  const n = (st: string) => job.items.filter((i) => i.status === st).length;
  if (job.state === "cancelled") return "Cancelada";
  if (job.state === "error" && !job.items.length) return `Error: ${job.error ?? "desconocido"}`;
  const parts = [`${n("done")} nuevas`, `${n("skipped")} ya estaban`];
  if (n("error")) parts.push(`${n("error")} con error`);
  return parts.join(", ");
}

/** Lanza una pasada (o devuelve la que ya está en marcha). */
export function runSync(id: string): Job {
  const sync = load().find((s) => s.id === id);
  if (!sync) throw httpError(404, "No existe esa sincronización");
  const running = activeJobForSync(id);
  if (running) return running;
  return startJob(sync.url, sync.format, sync.quality, {
    dir: sync.dir,
    syncId: sync.id,
    onFinish: (job) => {
      // Se relee: entre medias pudo cambiar o borrarse.
      const syncs = load();
      const s = syncs.find((x) => x.id === id);
      if (!s) return;
      if (job.items.length) s.title = job.title;
      s.lastRunAt = Date.now();
      s.lastResult = summary(job);
      save(syncs);
    },
  });
}

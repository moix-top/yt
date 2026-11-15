// Trabajos de descarga en curso: lanzan yt-dlp como proceso hijo y van
// anotando el estado de cada pista. Viven en memoria (en globalThis, para
// sobrevivir a la recarga en caliente de `next dev`): al reiniciar el servidor
// se pierde el historial, no los archivos, y relanzar una lista solo baja lo que
// falte gracias al --download-archive.
//
// Un trabajo de sincronización (lista ↔ carpeta, ver syncs.ts) además lleva en
// la carpeta un índice `.yt-sync.json` {id de vídeo: archivo}. Antes de cada
// pasada se genera el archivo de yt-dlp con las pistas cuyo archivo EXISTE: si
// borras una canción a mano, vuelve a bajarse. Lo que protege la carpeta de un
// corte de luz a mitad está en recovery.ts.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { sessionArgs } from "./cookies";
import { finishFolder, flushFile, prepareFolder, saveIndex, type Index } from "./recovery";
import { SESSION_THROTTLE, SYNC_ARCHIVE, buildArgs, needsLogin, parseLine, type Format } from "./options";

export type ItemStatus = "pending" | "downloading" | "done" | "skipped" | "error";

export interface Item {
  id: string;
  title: string;
  status: ItemStatus;
  pct: number;
  error?: string;
}

export interface Job {
  id: string;
  url: string;
  title: string;
  format: Format;
  quality: string;
  dir: string;
  state: "listing" | "running" | "done" | "error" | "cancelled";
  error?: string;
  items: Item[];
  createdAt: number;
  /** Sincronización guardada que lanzó este trabajo, si la hay. */
  syncId?: string;
  /** Aviso informativo, p. ej. lo que se reparó tras un corte. */
  notice?: string;
}

export interface JobOptions {
  /** Carpeta de destino; por defecto downloadsDir() con una subcarpeta por lista. */
  dir?: string;
  syncId?: string;
  onFinish?: (job: Job) => void;
}

interface Store {
  jobs: Map<string, Job>;
  procs: Map<string, ChildProcess>;
}
const g = globalThis as unknown as { __ytDownloads?: Store };
const store: Store = (g.__ytDownloads ??= { jobs: new Map(), procs: new Map() });

/** Copia propia y al día (scripts/update-yt-dlp.sh) antes que la del sistema. */
export function ytDlpBin(): string {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN;
  const local = path.join(process.cwd(), ".bin", "yt-dlp");
  return existsSync(local) ? local : "yt-dlp";
}

export function downloadsDir(): string {
  if (process.env.DOWNLOADS_DIR) return process.env.DOWNLOADS_DIR;
  const es = path.join(homedir(), "Descargas");
  return path.join(existsSync(es) ? es : path.join(homedir(), "Downloads"), "yt");
}

function run(args: string[], onLine: (line: string) => void, jobId?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(ytDlpBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    if (jobId) store.procs.set(jobId, p);
    createInterface({ input: p.stdout }).on("line", onLine);
    createInterface({ input: p.stderr }).on("line", onLine);
    p.on("error", (e) =>
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new Error("yt-dlp no está instalado") : e),
    );
    p.on("close", (code) => {
      if (jobId) store.procs.delete(jobId);
      resolve(code ?? 1);
    });
  });
}

/**
 * Título y pistas de la lista, sin descargar nada. Primero sin sesión; si
 * YouTube dice que es privada y hay cookies configuradas, otra vez con ellas.
 * `auth` son las opciones de sesión que habrá que usar también al descargar.
 */
async function list(url: string): Promise<{ title: string; items: Item[]; auth: string[] }> {
  const attempt = async (auth: string[]) => {
    let json = "";
    const errors: string[] = [];
    const code = await run(["--flat-playlist", "-J", "--js-runtimes", "node", ...auth, "--", url], (l) => {
      if (l.startsWith("{")) json = l;
      else if (l.startsWith("ERROR:")) errors.push(l.slice(7));
    });
    return { json: code === 0 ? json : "", error: errors[0] ?? "No se pudo leer la lista" };
  };
  let auth: string[] = [];
  let { json, error } = await attempt(auth);
  if (!json && needsLogin(error)) {
    const session = sessionArgs();
    if (!session.length)
      throw new Error("Es una lista privada: elige arriba el navegador y perfil con tu sesión de YouTube");
    ({ json, error } = await attempt(session));
    auth = [...session, ...SESSION_THROTTLE];
  }
  if (!json) throw new Error(error);
  const j = JSON.parse(json) as { title?: string; id: string; entries?: { id: string; title?: string }[] };
  // Un vídeo suelto no trae `entries`: es una lista de uno.
  const entries = j.entries ?? [{ id: j.id, title: j.title }];
  return {
    title: j.title ?? url,
    items: entries.map((e) => ({ id: e.id, title: e.title ?? e.id, status: "pending", pct: 0 })),
    auth,
  };
}

export function listJobs(): Job[] {
  return [...store.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function startJob(url: string, format: Format, quality: string, opts: JobOptions = {}): Job {
  const dir = opts.dir ?? downloadsDir();
  const job: Job = {
    id: randomUUID(),
    url,
    title: "Leyendo la lista…",
    format,
    quality,
    dir,
    state: "listing",
    items: [],
    createdAt: Date.now(),
    syncId: opts.syncId,
  };
  store.jobs.set(job.id, job);
  void execute(job).finally(() => opts.onFinish?.(job));
  return job;
}

export function activeJobForSync(syncId: string): Job | undefined {
  return [...store.jobs.values()].find(
    (j) => j.syncId === syncId && (j.state === "listing" || j.state === "running"),
  );
}

/** Pistas que ya están (sanas) en la carpeta, y el archivo de yt-dlp a juego. */
async function prepareSync(job: Job): Promise<{ index: Index; present: Set<string> }> {
  const { index, report } = await prepareFolder(job.dir, job.format);
  if (report) job.notice = report;
  const present = new Set(Object.keys(index));
  writeFileSync(path.join(job.dir, SYNC_ARCHIVE), [...present].map((id) => `youtube ${id}\n`).join(""));
  return { index, present };
}

async function execute(job: Job) {
  // Función y no comparación directa: cancelJob cambia el estado durante los
  // await, y TypeScript no lo ve.
  const cancelled = () => job.state === "cancelled";
  // La carpeta de una sincronización quedó preparada: al acabar (bien,
  // cancelada o con error, pero no por un corte) se cierra el diario.
  let prepared = false;
  try {
    const { title, items, auth } = await list(job.url);
    if (cancelled()) return;
    job.title = title;
    job.items = items;
    job.state = "running";
    mkdirSync(job.dir, { recursive: true });

    const sync = job.syncId ? await prepareSync(job) : null;
    if (sync) prepared = true;
    if (sync) for (const i of items) if (sync.present.has(i.id)) Object.assign(i, { status: "skipped", pct: 100 });

    const byId = new Map(items.map((i) => [i.id, i]));
    // Pista en curso: algunos errores de yt-dlp no dicen de qué vídeo son.
    let current: Item | undefined;
    // Archivos que va escribiendo la pista en curso, para borrarlos si se cancela.
    let partial: string[] = [];
    const fail = (item: Item, message: string) => Object.assign(item, { status: "error", error: message });
    const code = await run(
      buildArgs(job.url, job.format, job.quality, job.dir, sync ? "sync" : "lists", auth),
      (line) => {
        const dest = line.match(/(?:Destination|thumbnail \d+ to): (.+)$/);
        if (dest) partial.push(dest[1]);
        const ev = parseLine(line);
        if (!ev) return;
        const item = ev.id ? byId.get(ev.id) : current;
        if (ev.kind === "error") {
          if (item) fail(item, ev.message);
          else job.error = ev.message;
          return;
        }
        if (!item) return;
        if (ev.kind === "start") {
          if (current?.status === "downloading") fail(current, "Se cortó la descarga");
          // `partial` no se vacía aquí: la carátula se escribe antes de este aviso.
          current = item;
          Object.assign(item, { status: "downloading", pct: 0 });
        }
        // Vídeo y audio van por separado: el porcentaje vuelve a 0 a mitad.
        else if (ev.kind === "progress") item.pct = Math.max(item.pct, Math.min(99, ev.pct));
        else if (ev.kind === "done") {
          partial = [];
          Object.assign(item, { status: "done", pct: 100 });
          if (sync) {
            // Primero a disco el archivo, luego el índice: un corte entre medias
            // deja un archivo sano fuera del índice, que la próxima pasada adopta.
            flushFile(ev.file);
            sync.index[item.id] = { file: path.relative(job.dir, ev.file), at: Date.now() };
            saveIndex(job.dir, sync.index);
          }
        }
        else if (ev.kind === "skipped") Object.assign(item, { status: "skipped", pct: 100 });
      },
      job.id,
    );
    if (cancelled()) {
      if (current?.status === "downloading") Object.assign(current, { status: "pending", pct: 0 });
      removePartial(partial);
      return;
    }
    if (current?.status === "downloading") fail(current, "Se cortó la descarga");
    // Con --ignore-errors, un código distinto de 0 solo indica que alguna pista
    // falló; ya queda marcada en su fila.
    job.state = items.some((i) => i.status === "done" || i.status === "skipped") || code === 0 ? "done" : "error";
    if (job.state === "error") job.error ??= "No se pudo descargar nada";
  } catch (e) {
    if (!cancelled()) {
      job.state = "error";
      job.error = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (prepared) {
      try {
        finishFolder(job.dir);
      } catch {
        // Si la carpeta ya no se puede tocar, la próxima pasada lo tratará como un corte.
      }
    }
  }
}

/**
 * Borra lo que dejó a medias una pista cortada: el audio o vídeo en bruto, los
 * .part, la carátula suelta y la conversión sin terminar. Todos comparten el
 * nombre base del destino, sin extensión ("003 - Título.webm", ".webp", ".mp3"…).
 */
function removePartial(paths: string[]) {
  const stems = new Set(paths.map((p) => p.replace(/(\.f\d+)?\.[^./]+$/, "")));
  for (const stem of stems) {
    const dir = path.dirname(stem);
    const base = path.basename(stem);
    try {
      for (const f of readdirSync(dir)) if (f.startsWith(`${base}.`)) rmSync(path.join(dir, f), { force: true });
    } catch {
      // La carpeta puede no existir aún: no hay nada que borrar.
    }
  }
}

export function cancelJob(id: string): boolean {
  const job = store.jobs.get(id);
  if (!job) return false;
  if (job.state === "listing" || job.state === "running") {
    job.state = "cancelled";
    store.procs.get(id)?.kill("SIGTERM");
  }
  return true;
}

/** Quita del historial los trabajos que ya no están en marcha. */
export function clearFinished() {
  for (const [id, job] of store.jobs) if (job.state !== "listing" && job.state !== "running") store.jobs.delete(id);
}

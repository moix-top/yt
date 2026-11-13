// Descarga de listas (YouTube y YouTube Music) con yt-dlp. Este módulo es puro:
// formatos, argumentos de yt-dlp y lectura de su salida. Lo importa también la
// página, así que aquí no entra nada de node:*.
//
// Solo existe en local (`npm run dev`, o NEXT_PUBLIC_DOWNLOADS=1 en un
// `next start` propio): en Vercel no hay yt-dlp ni disco donde dejar archivos.

export const downloadsEnabled =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DOWNLOADS === "1";

export type Format = "mp3" | "mp4";

export const QUALITIES: Record<Format, { id: string; label: string }[]> = {
  mp3: [
    { id: "320", label: "320 kbps (máxima)" },
    { id: "256", label: "256 kbps" },
    { id: "192", label: "192 kbps" },
    { id: "128", label: "128 kbps (ocupa menos)" },
  ],
  mp4: [
    { id: "best", label: "La mejor disponible" },
    { id: "2160", label: "4K (2160p)" },
    { id: "1440", label: "1440p" },
    { id: "1080", label: "1080p" },
    { id: "720", label: "720p" },
    { id: "480", label: "480p" },
    { id: "360", label: "360p (ocupa menos)" },
  ],
};

export const DEFAULT_QUALITY: Record<Format, string> = { mp3: "320", mp4: "1080" };

export function isValidQuality(format: string, quality: string): format is Format {
  return (format === "mp3" || format === "mp4") && QUALITIES[format].some((q) => q.id === quality);
}

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

/** Solo enlaces https de YouTube / YouTube Music; nada que yt-dlp lea como opción. */
export function parseSourceUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    return u.protocol === "https:" && HOSTS.has(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

// Marcas en la salida de yt-dlp para seguir cada pista: S = empieza,
// P = progreso, D = terminada (con su ruta final).
const MARK = "@@";

/** Argumentos de yt-dlp para bajar `url` a `dir` en el formato pedido. */
export function buildArgs(url: string, format: Format, quality: string, dir: string): string[] {
  const media =
    format === "mp3"
      ? ["-x", "--audio-format", "mp3", "--audio-quality", `${quality}K`]
      : [
          "-f",
          // H.264 + AAC primero, que es lo que reproduce cualquier tele o móvil;
          // si no lo hay a esa altura, lo mejor que haya hasta ella.
          quality === "best"
            ? "bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b"
            : `bv*[height<=${quality}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${quality}]+ba/b[height<=${quality}]/b`,
          "--merge-output-format",
          "mp4",
        ];
  return [
    // --print activa el modo silencioso, y sin él no salen las líneas de
    // "ya descargada" ni los destinos que se usan para limpiar al cancelar.
    "--no-quiet",
    "--js-runtimes", "node",
    "--remote-components", "ejs:github",
    "--yes-playlist",
    "--ignore-errors",
    "--newline",
    "--progress",
    "--progress-template", `download:${MARK}P %(info.id)s %(progress._percent_str)s`,
    "--print", `before_dl:${MARK}S %(id)s`,
    "--print", `after_move:${MARK}D %(id)s %(filepath)s`,
    // Un archivo por formato y calidad: relanzar la lista solo baja lo nuevo.
    "--download-archive", `${dir}/.descargados-${format}-${quality}.txt`,
    ...media,
    "--embed-metadata",
    "--embed-thumbnail",
    "-o", `${dir}/%(playlist_title|Sueltos)s/%(playlist_index&{:03d} - |)s%(title)s.%(ext)s`,
    "--",
    url,
  ];
}

export type Event =
  | { kind: "start"; id: string }
  | { kind: "progress"; id: string; pct: number }
  | { kind: "done"; id: string; file: string }
  | { kind: "skipped"; id: string }
  | { kind: "error"; id: string | null; message: string };

/** Traduce una línea de yt-dlp a un evento, o null si no interesa. */
export function parseLine(line: string): Event | null {
  const m = line.match(/^@@([SPD]) (\S+)(?: (.*))?$/);
  if (m) {
    const [, k, id, rest = ""] = m;
    if (k === "S") return { kind: "start", id };
    if (k === "D") return { kind: "done", id, file: rest };
    const pct = parseFloat(rest);
    return Number.isFinite(pct) ? { kind: "progress", id, pct } : null;
  }
  const skip = line.match(/^\[download\] ([\w-]{11}): .*has already been recorded in the archive/);
  if (skip) return { kind: "skipped", id: skip[1] };
  const err = line.match(/^ERROR: (?:\[[^\]]+\] ([\w-]{11}): )?(.*)$/);
  if (err) return { kind: "error", id: err[1] ?? null, message: err[2] };
  return null;
}

// De qué navegador y perfil saca yt-dlp la sesión de YouTube, para las listas
// privadas («Me gusta»). Se elige en la página de Descargas y se guarda en
// web/.data/ajustes.json; si no hay nada guardado, vale
// YTDLP_COOKIES_FROM_BROWSER / YTDLP_COOKIES del entorno.
//
// Las cookies nunca se leen aquí: solo se le dice a yt-dlp dónde están.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface Profile {
  /** Ruta del perfil: es lo que se le pasa a yt-dlp (`navegador:ruta`). */
  path: string;
  label: string;
}

export interface Browser {
  /** Nombre que entiende yt-dlp en --cookies-from-browser. */
  id: string;
  label: string;
  profiles: Profile[];
}

export interface CookieChoice {
  browser: string;
  profile: string;
}

// Navegadores basados en Chromium: carpeta de configuración (Linux) y nombre en yt-dlp.
const CHROMIUM: [string, string, string[]][] = [
  ["brave", "Brave", [".config/BraveSoftware/Brave-Browser"]],
  ["chrome", "Google Chrome", [".config/google-chrome"]],
  ["chromium", "Chromium", [".config/chromium", "snap/chromium/common/chromium"]],
  ["edge", "Microsoft Edge", [".config/microsoft-edge"]],
  ["vivaldi", "Vivaldi", [".config/vivaldi"]],
  ["opera", "Opera", [".config/opera"]],
];
const FIREFOX = [".mozilla/firefox", "snap/firefox/common/.mozilla/firefox", ".var/app/org.mozilla.firefox/.mozilla/firefox"];

function chromiumProfiles(dir: string): Profile[] {
  try {
    const state = JSON.parse(readFileSync(path.join(dir, "Local State"), "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    return Object.entries(state.profile?.info_cache ?? {})
      .filter(([sub]) => existsSync(path.join(dir, sub)))
      .map(([sub, info]) => ({ path: path.join(dir, sub), label: `${info.name ?? sub} (${sub})` }));
  } catch {
    return [];
  }
}

function firefoxProfiles(dir: string): Profile[] {
  let ini: string;
  try {
    ini = readFileSync(path.join(dir, "profiles.ini"), "utf8");
  } catch {
    return [];
  }
  const out: Profile[] = [];
  for (const block of ini.split(/^\[/m).filter((b) => b.startsWith("Profile"))) {
    const get = (k: string) => block.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
    const p = get("Path");
    if (!p) continue;
    const full = get("IsRelative") === "0" ? p : path.join(dir, p);
    if (existsSync(full)) out.push({ path: full, label: get("Name") ?? p });
  }
  return out;
}

/** Navegadores instalados con al menos un perfil. */
export function detectBrowsers(): Browser[] {
  const home = homedir();
  const found: Browser[] = [];
  for (const [id, label, dirs] of CHROMIUM) {
    const profiles = dirs.flatMap((d) => chromiumProfiles(path.join(home, d)));
    if (profiles.length) found.push({ id, label, profiles });
  }
  const ff = FIREFOX.flatMap((d) => firefoxProfiles(path.join(home, d)));
  if (ff.length) found.push({ id: "firefox", label: "Firefox", profiles: ff });
  return found;
}

const FILE = path.join(process.cwd(), ".data", "ajustes.json");

interface Settings {
  /** null = elegido «no usar sesión»; ausente = no se ha elegido (vale el entorno). */
  cookies?: CookieChoice | null;
}

function load(): Settings {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function getChoice(): CookieChoice | null | undefined {
  return load().cookies;
}

export function setChoice(choice: CookieChoice | null) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify({ ...load(), cookies: choice }, null, 2));
}

/** Solo se aceptan navegador y perfil detectados: nada de rutas arbitrarias. */
export function isDetected(choice: CookieChoice): boolean {
  return detectBrowsers().some((b) => b.id === choice.browser && b.profiles.some((p) => p.path === choice.profile));
}

/** Opciones de yt-dlp para usar la sesión, o [] si no hay ninguna configurada. */
export function sessionArgs(choice = getChoice()): string[] {
  if (choice) return ["--cookies-from-browser", `${choice.browser}:${choice.profile}`];
  if (choice === null) return [];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) return ["--cookies-from-browser", process.env.YTDLP_COOKIES_FROM_BROWSER];
  if (process.env.YTDLP_COOKIES) return ["--cookies", process.env.YTDLP_COOKIES];
  return [];
}

/**
 * Comprueba la sesión leyendo «Me gusta» con ella. Devuelve cuántas canciones
 * ve, o el error de yt-dlp.
 */
export function testSession(ytDlp: string, choice: CookieChoice): Promise<{ count: number } | { error: string }> {
  return new Promise((resolve) => {
    const args = [
      ...sessionArgs(choice),
      "--flat-playlist",
      "-J",
      "--js-runtimes",
      "node",
      "--",
      "https://music.youtube.com/playlist?list=LM",
    ];
    const p = spawn(ytDlp, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ error: e.message }));
    p.on("close", () => {
      try {
        const j = JSON.parse(out) as { entries?: unknown[] };
        resolve({ count: j.entries?.length ?? 0 });
      } catch {
        const line = err.split("\n").find((l) => l.startsWith("ERROR:"));
        resolve({ error: line?.slice(7) ?? "No se pudo leer «Me gusta» con esta sesión" });
      }
    });
  });
}

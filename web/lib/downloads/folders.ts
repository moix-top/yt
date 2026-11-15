// Diálogos del escritorio para la página de Descargas (solo en local): elegir
// una carpeta con el selector nativo y abrir una en el gestor de archivos. El
// navegador no puede dar la ruta absoluta de una carpeta, pero el servidor corre
// en el mismo ordenador y sí puede abrir el diálogo del sistema.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { httpError } from "@/lib/http";

function exec(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Abre el selector de carpetas del escritorio (zenity en GNOME, kdialog en KDE)
 * y espera a que se elija una. null si se cierra sin elegir.
 */
export async function pickDir(start?: string): Promise<string | null> {
  const from = start && isDir(start) ? `${start.replace(/\/$/, "")}/` : undefined;
  const dialogs: [string, string[]][] = [
    ["zenity", ["--file-selection", "--directory", "--title=Carpeta para la lista", ...(from ? [`--filename=${from}`] : [])]],
    ["kdialog", ["--getexistingdirectory", from ?? "", "--title", "Carpeta para la lista"]],
  ];
  for (const [cmd, args] of dialogs) {
    try {
      const { code, out } = await exec(cmd, args);
      return code === 0 && out ? out : null;
    } catch (e) {
      // No instalado: se prueba el siguiente.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  throw httpError(501, "No hay selector de carpetas: instala zenity (sudo apt install zenity)");
}

/** Abre una carpeta existente en el gestor de archivos. */
export async function openDir(dir: string): Promise<void> {
  if (!isDir(dir)) throw httpError(404, "La carpeta no existe todavía");
  // xdg-open vuelve enseguida; el gestor de archivos sigue abierto por su cuenta.
  spawn("xdg-open", [dir], { stdio: "ignore", detached: true }).unref();
}

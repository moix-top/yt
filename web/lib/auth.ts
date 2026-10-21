// Puerta de las rutas de API. Lanza HttpError(401), que el `catch { jsonError }`
// que tienen todas las handlers convierte en {"error":"No autenticado"} con
// status 401 — JSON, no un redirect HTML, que es lo que espera un cliente fetch.
//
// Vive en lib/ y no en lib/services/ porque no toca persistencia: solo lee la
// sesión de la petición en curso.
//
// 🔒 Este módulo es la ÚNICA fuente del identificador de usuario. Ninguna ruta
// puede leerlo del body, la query o la URL: si lo hiciera, un usuario podría
// nombrar la partición de otro. Ver lib/services/videoService.ts.

import type { Session } from "next-auth";
import { httpError } from "@/lib/http";

export interface SessionUser {
  /** Identificador de usuario: el email verificado de Google, normalizado. */
  userId: string;
  email: string;
  googleSub?: string;
  name?: string | null;
  image?: string | null;
}

/** Misma normalización en login, en las rutas y en el script de import. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Versión inyectable, para poder testear el contrato (401) sin next-auth ni
 * mocks.
 */
export async function requireSessionWith(
  getSession: () => Promise<Session | null>,
): Promise<SessionUser> {
  const session = await getSession();
  const email = session?.user?.email;
  if (!email) throw httpError(401, "No autenticado");
  return {
    userId: normalizeEmail(email),
    email: normalizeEmail(email),
    googleSub: session?.user?.googleSub,
    name: session?.user?.name,
    image: session?.user?.image,
  };
}

/**
 * Sesión válida o 401. Primera línea de toda ruta de API.
 *
 * `@/auth` se importa en diferido a propósito: cargarlo arriba metería
 * next-auth en el grafo del módulo y los tests (entorno node, sin runtime de
 * Next) no podrían ni importar este fichero. En una petición real el módulo
 * queda cacheado tras la primera carga.
 */
export async function requireSession(): Promise<SessionUser> {
  const { auth } = await import("@/auth");
  return requireSessionWith(auth);
}

/**
 * Para /api/sync, que la llaman la web (cookie de sesión) y el APK
 * (`Authorization: Bearer yt_…`). El token se resuelve en el servidor a un
 * userId: sigue sin aceptarse un usuario que venga del cliente.
 */
export async function requireUser(req: Request): Promise<string> {
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const { resolveToken } = await import("@/lib/services/videoService");
    const userId = await resolveToken(header.slice(7).trim());
    if (!userId) throw httpError(401, "Token no válido");
    return userId;
  }
  return (await requireSession()).userId;
}

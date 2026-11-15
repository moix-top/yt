// Sincronizaciones lista ↔ carpeta (solo en local, ver lib/downloads/syncs.ts).
// GET: las guardadas. POST: guarda una nueva y lanza la primera pasada.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { httpError, jsonError } from "@/lib/http";
import { downloadsEnabled, isValidQuality, parseSourceUrl } from "@/lib/downloads/options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guard() {
  await requireSession();
  if (!downloadsEnabled) throw httpError(404, "Las sincronizaciones solo están disponibles en local");
  return import("@/lib/downloads/syncs");
}

export async function GET() {
  try {
    const syncs = await guard();
    return NextResponse.json({ syncs: syncs.listSyncs() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const syncs = await guard();
    const body = (await req.json().catch(() => ({}))) as {
      url?: string;
      dir?: string;
      format?: string;
      quality?: string;
    };
    const url = parseSourceUrl(body.url ?? "");
    if (!url) throw httpError(400, "No parece un enlace de YouTube o YouTube Music");
    const dir = syncs.resolveDir(body.dir ?? "");
    if (!dir) throw httpError(400, "La carpeta tiene que ser una ruta completa, p. ej. ~/Música/Favoritas");
    const format = body.format ?? "";
    const quality = body.quality ?? "";
    if (!isValidQuality(format, quality)) throw httpError(400, "Formato o calidad no válidos");
    const sync = syncs.createSync(url, dir, format, quality);
    syncs.runSync(sync.id);
    return NextResponse.json({ sync }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

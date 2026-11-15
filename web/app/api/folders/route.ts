// Diálogos del escritorio (solo en local, ver lib/downloads/folders.ts).
// POST {action: "pick", start?} → {dir | null}. POST {action: "open", dir} → abre la carpeta.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { httpError, jsonError } from "@/lib/http";
import { downloadsEnabled } from "@/lib/downloads/options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireSession();
    if (!downloadsEnabled) throw httpError(404, "Solo disponible en local");
    const { pickDir, openDir } = await import("@/lib/downloads/folders");
    const { resolveDir } = await import("@/lib/downloads/syncs");
    const body = (await req.json().catch(() => ({}))) as { action?: string; start?: string; dir?: string };
    const start = resolveDir(body.start ?? "") ?? undefined;

    if (body.action === "pick") return NextResponse.json({ dir: await pickDir(start) });
    if (body.action === "open") {
      const dir = resolveDir(body.dir ?? "");
      if (!dir) throw httpError(400, "Ruta no válida");
      await openDir(dir);
      return NextResponse.json({ ok: true });
    }
    throw httpError(400, "Acción no válida");
  } catch (e) {
    return jsonError(e);
  }
}

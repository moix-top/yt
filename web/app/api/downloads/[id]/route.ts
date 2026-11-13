// Cancela un trabajo de descarga en curso.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { httpError, jsonError } from "@/lib/http";
import { downloadsEnabled } from "@/lib/downloads/options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireSession();
    if (!downloadsEnabled) throw httpError(404, "Las descargas solo están disponibles en local");
    const { cancelJob } = await import("@/lib/downloads/jobs");
    if (!cancelJob(params.id)) throw httpError(404, "No existe esa descarga");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

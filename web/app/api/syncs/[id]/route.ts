// POST: sincroniza ahora. DELETE: olvida la sincronización (la carpeta no se toca).

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { httpError, jsonError } from "@/lib/http";
import { downloadsEnabled } from "@/lib/downloads/options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guard() {
  await requireSession();
  if (!downloadsEnabled) throw httpError(404, "Las sincronizaciones solo están disponibles en local");
  return import("@/lib/downloads/syncs");
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const syncs = await guard();
    return NextResponse.json({ job: syncs.runSync(params.id) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const syncs = await guard();
    if (!syncs.deleteSync(params.id)) throw httpError(404, "No existe esa sincronización");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

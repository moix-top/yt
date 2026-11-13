// Descargas de listas con yt-dlp (solo en local, ver lib/downloads/options.ts).
// GET: estado de los trabajos. POST: lanza uno. DELETE: limpia los terminados.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { httpError, jsonError } from "@/lib/http";
import { downloadsEnabled, isValidQuality, parseSourceUrl } from "@/lib/downloads/options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guard() {
  await requireSession();
  if (!downloadsEnabled) throw httpError(404, "Las descargas solo están disponibles en local");
  return import("@/lib/downloads/jobs");
}

export async function GET() {
  try {
    const jobs = await guard();
    return NextResponse.json({ dir: jobs.downloadsDir(), jobs: jobs.listJobs() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const jobs = await guard();
    const body = (await req.json().catch(() => ({}))) as { url?: string; format?: string; quality?: string };
    const url = parseSourceUrl(body.url ?? "");
    if (!url) throw httpError(400, "No parece un enlace de YouTube o YouTube Music");
    const format = body.format ?? "";
    const quality = body.quality ?? "";
    if (!isValidQuality(format, quality)) throw httpError(400, "Formato o calidad no válidos");
    return NextResponse.json({ job: jobs.startJob(url, format, quality) }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE() {
  try {
    const jobs = await guard();
    jobs.clearFinished();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

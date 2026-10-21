// Título y canal de un vídeo vía oEmbed de YouTube (público, sin API key). Se
// hace en el servidor porque oEmbed no manda cabeceras CORS.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { httpError, jsonError } from "@/lib/http";
import { parseVideoId } from "@/lib/merge";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireSession();
    const input = new URL(req.url).searchParams.get("url") ?? "";
    const videoId = parseVideoId(input);
    if (!videoId) throw httpError(400, "No parece un enlace de YouTube");

    const watch = `https://www.youtube.com/watch?v=${videoId}`;
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
    // Vídeos privados o con oEmbed desactivado: se guardan igual, sin título.
    if (!r.ok) return NextResponse.json({ videoId, title: "", channel: "" });
    const j = (await r.json()) as { title?: string; author_name?: string };
    return NextResponse.json({ videoId, title: j.title ?? "", channel: j.author_name ?? "" });
  } catch (e) {
    return jsonError(e);
  }
}

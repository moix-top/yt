// Sincronización web ⇄ APK. Un único POST: el cliente manda sus cambios
// pendientes y su cursor, y recibe todo lo que ha cambiado desde entonces.
// Contrato en lib/types.ts (SyncRequest / SyncResponse).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { sync } from "@/lib/services/videoService";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const userId = await requireUser(req);
    const body = await req.json().catch(() => null);
    return NextResponse.json(await sync(userId, body));
  } catch (e) {
    return jsonError(e);
  }
}

// Tokens de sincronización del APK. Solo con sesión de Google: un token no puede
// crear otros tokens.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { createToken, listTokens } from "@/lib/services/videoService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId } = await requireSession();
    return NextResponse.json({ tokens: await listTokens(userId) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { label?: unknown };
    const label = typeof body.label === "string" ? body.label : "";
    // El token en claro solo existe en esta respuesta.
    return NextResponse.json({ token: await createToken(userId, label) }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

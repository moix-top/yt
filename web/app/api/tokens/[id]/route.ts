import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { revokeToken } from "@/lib/services/videoService";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { userId } = await requireSession();
    await revokeToken(userId, params.id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return jsonError(e);
  }
}

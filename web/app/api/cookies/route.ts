// Sesión de YouTube para listas privadas (solo en local, ver lib/downloads/cookies.ts).
// GET: navegadores y perfiles detectados + lo elegido. PUT: guarda la elección
// ({browser, profile} o null = no usar). POST: prueba una elección leyendo «Me gusta».

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { httpError, jsonError } from "@/lib/http";
import { downloadsEnabled } from "@/lib/downloads/options";
import type { CookieChoice } from "@/lib/downloads/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guard() {
  await requireSession();
  if (!downloadsEnabled) throw httpError(404, "Solo disponible en local");
  return import("@/lib/downloads/cookies");
}

async function readChoice(req: Request, cookies: Awaited<ReturnType<typeof guard>>): Promise<CookieChoice | null> {
  const body = (await req.json().catch(() => ({}))) as { browser?: string; profile?: string } | null;
  if (!body?.browser) return null;
  const choice = { browser: body.browser, profile: body.profile ?? "" };
  if (!cookies.isDetected(choice)) throw httpError(400, "Ese navegador o perfil no está en este ordenador");
  return choice;
}

export async function GET() {
  try {
    const cookies = await guard();
    const choice = cookies.getChoice();
    return NextResponse.json({
      browsers: cookies.detectBrowsers(),
      choice: choice ?? null,
      // Sin elección guardada puede estar valiendo la variable de entorno.
      fromEnv: choice === undefined && cookies.sessionArgs().length > 0,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const cookies = await guard();
    cookies.setChoice(await readChoice(req, cookies));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const cookies = await guard();
    const choice = await readChoice(req, cookies);
    if (!choice) throw httpError(400, "Elige un navegador y un perfil");
    const { ytDlpBin } = await import("@/lib/downloads/jobs");
    return NextResponse.json(await cookies.testSession(ytDlpBin(), choice));
  } catch (e) {
    return jsonError(e);
  }
}

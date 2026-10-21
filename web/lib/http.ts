import { NextResponse } from "next/server";

// Los errores del servicio llevan su status HTTP (4xx para validación,
// conflictos, no encontrado); las rutas los mapean de forma uniforme.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

export function jsonError(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 500 });
}

// Protege la UI: sin sesión, a /login. Usa solo auth.config.ts (edge-safe), no
// auth.ts, porque el middleware corre en Edge Runtime y no puede arrastrar el
// SDK de AWS.
//
// Las rutas de API quedan fuera aposta (el callback `authorized` las deja
// pasar): deben responder 401 JSON vía requireSession, no un redirect HTML.

import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Todo salvo: los propios endpoints de Auth.js (si no, bucle de redirects),
  // la pantalla de login, los estáticos de Next y los iconos de la app. Los
  // iconos tienen que quedar fuera aposta: los pide el navegador SIN sesión, en
  // la propia pantalla de login, y si el middleware los redirige a /login la
  // pestaña se queda sin icono.
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)"],
};

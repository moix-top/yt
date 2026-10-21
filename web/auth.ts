// Instancia de Auth.js. Se separa de auth.config.ts para que el middleware
// pueda importar solo la config (edge-safe) sin arrastrar nada de aquí.
//
// `auth()` lee la sesión en server components y en rutas de API;
// `signIn`/`signOut` se usan desde server actions en la UI.

import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

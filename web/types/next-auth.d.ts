// El `sub` de Google viaja en el token (auth.config.ts). No es el identificador
// de usuario —ese es el email—; se guarda para poder detectar si un email cambia
// de cuenta de origen.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { googleSub?: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    googleSub?: string;
  }
}

export {};

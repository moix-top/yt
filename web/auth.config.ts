// Configuración de Auth.js v5. Va separada de auth.ts porque ESTE fichero lo
// importa el middleware, que corre en Edge Runtime.
//
// ⚠️  REGLA: aquí no puede entrar NADA que arrastre @aws-sdk/* ni node:crypto
// (ni lib/dynamo.ts ni lib/services/*). Solo next-auth y lógica pura.

import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

// El tipo `Profile` de Auth.js no declara email_verified (es de Google).
interface GoogleProfile {
  sub?: string;
  email?: string | null;
  email_verified?: boolean;
}

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      // Vacíos por defecto para que el build de CI no reviente sin variables.
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
      authorization: { params: { prompt: "select_account" } },
    }),
    // Solo en `next dev` y con DEV_LOGIN_EMAIL definido: entrar sin Google para
    // probar la interfaz en local. En un build de producción no existe.
    ...(process.env.NODE_ENV === "development" && process.env.DEV_LOGIN_EMAIL
      ? [
          Credentials({
            id: "dev",
            name: "Desarrollo",
            credentials: {},
            authorize: () => {
              const email = process.env.DEV_LOGIN_EMAIL!;
              return { id: email, email, name: "Dev" };
            },
          }),
        ]
      : []),
  ],

  // JWT sin adaptador: los datos viven en DynamoDB bajo el email.
  session: { strategy: "jwt", maxAge: 90 * 24 * 60 * 60 },

  pages: { signIn: "/login" },

  // No definir AUTH_URL: el callback se deriva del Host.
  trustHost: true,

  callbacks: {
    // Registro abierto, pero solo con email verificado: el email es la clave de
    // partición y uno sin verificar permitiría reclamar los datos de otro.
    signIn({ account, profile }) {
      if (account?.provider === "dev") return true;
      const google = profile as GoogleProfile | undefined;
      if (!google?.email) return "/login?error=no-email";
      return google.email_verified === true ? true : "/login?error=email-not-verified";
    },

    jwt({ token, profile }) {
      const google = profile as GoogleProfile | undefined;
      if (google?.sub) token.googleSub = google.sub;
      return token;
    },

    session({ session, token }) {
      if (session.user) session.user.googleSub = token.googleSub as string | undefined;
      return session;
    },

    // Las rutas de API pasan siempre: responden 401 JSON por su cuenta, y
    // /api/sync además acepta el token del APK, que no lleva cookie.
    authorized({ auth, request }) {
      if (request.nextUrl.pathname.startsWith("/api/")) return true;
      return Boolean(auth?.user);
    },
  },
};

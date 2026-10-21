// Endpoints de Auth.js: /api/auth/signin, /callback/google, /signout, /session…
// Los genera next-auth; aquí solo se exponen.

import { handlers } from "@/auth";

export const dynamic = "force-dynamic";

export const { GET, POST } = handlers;

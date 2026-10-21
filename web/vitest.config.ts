import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mismo alias que tsconfig.json ("@/*" → raíz), para que los tests puedan
  // importar módulos que lo usan internamente (p. ej. lib/auth.ts → @/auth).
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

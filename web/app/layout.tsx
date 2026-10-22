import type { Metadata, Viewport } from "next";
import "./globals.css";
import SpatialNav from "./SpatialNav";

// Las páginas leen la sesión: nada de prerender estático (además el build de
// CI no tiene variables AUTH_*).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "yt",
  description: "YouTube sin distracciones: por ver, vistos y el segundo exacto donde lo dejaste.",
  applicationName: "yt",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0d0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <SpatialNav />
        {children}
      </body>
    </html>
  );
}

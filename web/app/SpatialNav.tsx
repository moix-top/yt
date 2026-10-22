"use client";

// Navegación con mando (Smart TV) o teclado: las flechas mueven el foco al
// elemento enfocable más cercano en esa dirección, y "Atrás" del mando vuelve
// a la página anterior. La primera pulsación de una flecha marca
// <html data-input="keys"> para que el CSS muestre la interfaz de TV.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const FOCUSABLE = "a[href], button:not(:disabled), input, iframe, [tabindex]:not([tabindex='-1'])";
const DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};
const BACK_KEYS = new Set(["GoBack", "BrowserBack", "Escape", "Backspace"]);

// Margen para bordes que se tocan o se pisan por redondeo.
const TOL = 2;

// Siguiente elemento en la dirección (dx, dy), comparando bordes y no centros,
// para que coincida con lo que se ve en pantalla:
// - Solo cuentan los que están enteros en esa dirección (para "abajo", su
//   borde superior por debajo del borde inferior del actual).
// - Gana el de menor hueco; estar desplazado en el otro eje (no solaparse)
//   pesa más, así "abajo" va a lo que está justo debajo y no en diagonal.
// - Empate (p. ej. una fila de botones): el más alineado con el actual.
function nearest(from: Element, dx: number, dy: number): HTMLElement | null {
  const f = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    let gap: number, offset: number, align: number;
    if (dy !== 0) {
      gap = dy > 0 ? r.top - f.bottom : f.top - r.bottom;
      offset = Math.max(0, r.left - f.right, f.left - r.right);
      align = Math.abs(r.left - f.left);
    } else {
      gap = dx > 0 ? r.left - f.right : f.left - r.right;
      offset = Math.max(0, r.top - f.bottom, f.top - r.bottom);
      align = Math.abs(r.top - f.top);
    }
    if (gap < -TOL) continue;
    const score = Math.max(0, gap) + offset * 4 + align * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export default function SpatialNav() {
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement;

      if (BACK_KEYS.has(e.key) && !typing && path !== "/") {
        e.preventDefault();
        router.back();
        return;
      }

      const dir = DIRS[e.key];
      if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
      document.documentElement.dataset.input = "keys";
      // En un campo de texto las flechas laterales mueven el cursor, salvo que
      // ya esté en el extremo: entonces saltan al elemento de al lado.
      if (typing && dir[0] !== 0) {
        const { selectionStart: s, selectionEnd: end, value } = active;
        const atEdge = s === end && (dir[0] > 0 ? end === value.length : s === 0);
        if (!atEdge) return;
      }

      const from = active && active !== document.body ? active : null;
      const next = from
        ? nearest(from, dir[0], dir[1])
        : document.querySelector<HTMLElement>(FOCUSABLE);
      if (!next) return;
      e.preventDefault();
      next.focus();
      next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    };
    // Volver a ratón/táctil quita el modo TV.
    const onPointer = () => delete document.documentElement.dataset.input;

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [path, router]);

  return null;
}

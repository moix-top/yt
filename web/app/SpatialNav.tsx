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

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Candidato más cercano en la dirección (dx, dy). Se penaliza la desviación
// lateral para que "abajo" prefiera lo que está justo debajo.
function nearest(from: Element, dx: number, dy: number): HTMLElement | null {
  const a = center(from.getBoundingClientRect());
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const b = center(r);
    const along = (b.x - a.x) * dx + (b.y - a.y) * dy;
    if (along <= 1) continue;
    const across = Math.abs((b.x - a.x) * dy + (b.y - a.y) * dx);
    const score = along + across * 3;
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

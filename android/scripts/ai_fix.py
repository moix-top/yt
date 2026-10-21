#!/usr/bin/env python3
"""
Intenta adaptar el fork a una versión nueva de NewPipe con un LLM (GLM, vía su
API compatible con OpenAI). Lo lanza el workflow android.yml solo cuando
prepare.sh o la compilación fallan.

    python3 -I android/scripts/ai_fix.py --mode patch --log build/apply.log
    python3 -I android/scripts/ai_fix.py --mode build --log build/assemble.log

Qué puede tocar, y nada más:
  --mode patch  → reescribe los ficheros de upstream afectados por los parches
                  que no aplican; después se regeneran los .patch con git diff.
  --mode build  → reescribe ficheros de android/overlay/ a partir del error de
                  compilación (lo normal: una API interna de NewPipe cambió).

Nunca hace commit a main: el workflow abre un PR con el resultado para que lo
revise una persona. Solo biblioteca estándar, para no instalar nada en CI.

Variables: GLM_API_KEY (obligatoria), GLM_BASE_URL, GLM_MODEL.
"""

import argparse
import json
import os
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent  # android/
UPSTREAM = ROOT / "upstream"
OVERLAY = ROOT / "overlay"
PATCHES = ROOT / "patches"

BASE_URL = os.environ.get("GLM_BASE_URL", "https://api.z.ai/api/paas/v4").rstrip("/")
MODEL = os.environ.get("GLM_MODEL", "glm-5.3")
MAX_FILE_CHARS = 60_000

SYSTEM = """Eres un ingeniero Android que mantiene un fork mínimo de NewPipe.
El fork añade un paquete org.schabi.newpipe.ytsync (sincronización con un servidor) y
unos pocos ganchos en ficheros de NewPipe. Tu trabajo es adaptar el fork a una versión
nueva de NewPipe cambiando lo MÍNIMO. No refactorices, no cambies el comportamiento.
Responde solo con ficheros completos, cada uno así:

=== FILE: ruta/relativa/al/repo/de/NewPipe ===
```
contenido completo del fichero
```
"""


def chat(prompt: str) -> str:
    key = os.environ.get("GLM_API_KEY")
    if not key:
        sys.exit("GLM_API_KEY no definida: no hay arreglo automático.")
    body = json.dumps({
        "model": MODEL,
        "temperature": 0.1,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def read(path: pathlib.Path) -> str:
    text = path.read_text(errors="replace")
    return text if len(text) <= MAX_FILE_CHARS else text[:MAX_FILE_CHARS] + "\n…(truncado)"


FILE_BLOCK = re.compile(r"=== FILE: (.+?) ===\s*```[a-zA-Z]*\n(.*?)```", re.S)


def write_answer(answer: str, base: pathlib.Path) -> list[str]:
    written = []
    for rel, content in FILE_BLOCK.findall(answer):
        rel = rel.strip()
        target = (base / rel).resolve()
        # El modelo solo puede escribir dentro del árbol que se le ha dado.
        if base.resolve() not in target.parents:
            print(f"Ignorado (fuera del árbol): {rel}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        written.append(rel)
    return written


def files_in_patch(patch: pathlib.Path) -> list[str]:
    return re.findall(r"^\+\+\+ b/(.+)$", patch.read_text(), re.M)


def fix_patches(log: str) -> None:
    failing = [p for p in sorted(PATCHES.glob("*.patch")) if f"✗ {p.name}" in log]
    for patch in failing:
        parts = [f"Este parche ya no aplica sobre la versión nueva de NewPipe.\n\n"
                 f"PARCHE ({patch.name}):\n```diff\n{patch.read_text()}```\n"]
        for rel in files_in_patch(patch):
            # --3way deja marcadores de conflicto: se le enseña el original limpio.
            os.system(f"git -C {UPSTREAM} checkout -q -- {rel} 2>/dev/null")
            f = UPSTREAM / rel
            parts.append(f"\nFICHERO ACTUAL DE NEWPIPE {rel}:\n```\n{read(f) if f.exists() else '(ya no existe)'}```\n")
        parts.append("\nDevuelve los ficheros de NewPipe con la MISMA intención del parche aplicada.")
        written = write_answer(chat("".join(parts)), UPSTREAM)
        if not written:
            sys.exit(f"La IA no devolvió ficheros para {patch.name}")
        # El parche nuevo es el diff entre el original (HEAD del clon) y lo escrito.
        diff = os.popen(f"git -C {UPSTREAM} diff -- {' '.join(written)}").read()
        patch.write_text(diff)
        print(f"Regenerado {patch.name} ({', '.join(written)})")


def fix_build(log: str) -> None:
    errors = "\n".join(l for l in log.splitlines() if l.startswith("e:") or "error:" in l)[:20_000]
    parts = [f"La compilación del fork falla con NewPipe nuevo. Errores:\n```\n{errors}\n```\n"]
    for f in sorted(OVERLAY.rglob("*.kt")):
        rel = f.relative_to(OVERLAY)
        parts.append(f"\nFICHERO DEL FORK {rel}:\n```kotlin\n{read(f)}```\n")
    # Contexto de upstream: los ficheros que nombran los errores.
    for rel in sorted(set(re.findall(r"file://\S*?/upstream/(\S+?\.kt)", log)))[:8]:
        f = UPSTREAM / rel
        if f.exists() and not (OVERLAY / rel).exists():
            parts.append(f"\nFICHERO DE NEWPIPE {rel} (solo contexto, no lo modifiques):\n```\n{read(f)}```\n")
    parts.append("\nDevuelve solo los ficheros del fork (rutas como arriba) corregidos.")
    written = write_answer(chat("".join(parts)), OVERLAY)
    if not written:
        sys.exit("La IA no devolvió ficheros")
    print("Reescritos:", ", ".join(written))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["patch", "build"], required=True)
    ap.add_argument("--log", required=True)
    a = ap.parse_args()
    log = pathlib.Path(a.log).read_text(errors="replace")
    fix_patches(log) if a.mode == "patch" else fix_build(log)


if __name__ == "__main__":
    main()

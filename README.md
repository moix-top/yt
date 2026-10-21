# yt · yt.moix.top

YouTube sin distracciones con tres cosas y nada más: **por ver**, **vistos** y el
**segundo exacto** donde dejaste cada vídeo. Sincronizado entre la web y el móvil.

| Carpeta | Qué es |
|---|---|
| [web/](web/) | Next.js 14 + Auth.js (Google) + DynamoDB. Mismo patrón que `wealth`. Desplegada en Vercel. |
| [android/](android/) | Fork de NewPipe: `overlay/` (código nuevo, paquete `ytsync`) + `patches/` (3 ganchos, ~11 líneas). |
| [.github/workflows/](.github/workflows/) | CI de la web, infra DynamoDB y el ciclo automático del APK. |

## Cómo se sincroniza

Una sola API, `POST /api/sync` ([web/lib/types.ts](web/lib/types.ts)): el cliente manda sus
cambios y su cursor y recibe todo lo cambiado desde entonces. Posición, "por ver" y
"visto" llevan cada uno su reloj y se fusionan por separado (gana el último).

- **Web**: sesión de Google.
- **APK**: token `yt_…` creado en la web (*Dispositivos*) y pegado en la app →
  *Ajustes → Sincronización yt.moix.top*. Sin Google Play Services. Se sincroniza al
  abrir y cerrar la app y cada 15 min. "Por ver" es una lista local con ese nombre.
- **Móvil sin APK**: la web es una PWA instalable y aparece en *Compartir* de Android.

## Ciclo automático del APK ([android.yml](.github/workflows/android.yml))

Cada día: ¿nueva release de NewPipe? → clona → copia `overlay/` → aplica `patches/`
(`--3way`) → compila → firma → **GitHub Release**. Con
[Obtainium](https://github.com/ImranR98/Obtainium) apuntando a este repo, el móvil se
actualiza solo.

Si un parche no aplica o no compila y existe `GLM_API_KEY`, GLM propone el arreglo y
llega como **PR**; el APK se publica al fusionarlo. Lo escrito por IA nunca se publica
sin revisión.

## Puesta en marcha (lo ejecutas tú)

1. **Google OAuth** y **Vercel**: igual que en `wealth/README.md`, con
   `https://yt.moix.top/api/auth/callback/google`. En Vercel, *Root Directory* = `web`.
2. **AWS** (perfil `radamuz`):
   ```bash
   cd web
   ./scripts/setup-github-secrets.sh --profile radamuz --repo moix-top/yt
   # GitHub → Actions → "Deploy infra (DynamoDB)" → Run workflow
   ./scripts/setup-aws.sh --profile radamuz      # imprime las variables para Vercel
   ```
3. **Firma del APK** (una vez; guarda el `.jks` fuera del repo):
   `android/scripts/setup-signing.sh --repo moix-top/yt`
4. **IA opcional**: `gh secret set GLM_API_KEY --repo moix-top/yt`
   (y `gh variable set GLM_MODEL` / `GLM_BASE_URL` si no son los de Z.ai por defecto).
5. Actions → *Android (fork de NewPipe)* → Run workflow.

## Desarrollo

```bash
cd web && npm install && npm test
DEV_LOGIN_EMAIL=yo@example.com AUTH_SECRET=x npm run dev   # entra sin Google, solo en dev

android/scripts/prepare.sh v0.29.1                          # árbol en android/upstream
cd android/upstream && ./gradlew assembleDebug              # requiere JDK 21
```

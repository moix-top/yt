# Pendiente

## Descargar «Me gusta» de YouTube Music

La página de Descargas (solo en local) baja listas públicas y no listadas, pero no
las privadas: yt-dlp entra sin sesión. «Me gusta» (`https://music.youtube.com/playlist?list=LM`)
es privada, así que hoy falla.

**Idea:** pasar a yt-dlp las cookies de la cuenta de Google.

- Opción A, la más cómoda: `--cookies-from-browser chrome` (o `firefox`). yt-dlp las
  lee directamente del perfil del navegador. Con Chrome abierto puede fallar por el
  bloqueo de la base de datos de cookies; Firefox suele dar menos guerra.
- Opción B: exportar un `cookies.txt` (formato Netscape) y pasar `--cookies <ruta>`.
  Caducan: hay que renovarlo de vez en cuando.

**Cambios previstos:**

1. Variable `YTDLP_COOKIES_FROM_BROWSER` (p. ej. `firefox`) o `YTDLP_COOKIES` (ruta
   al `cookies.txt`) en `web/.env.example`. Nunca en el repo.
2. `buildArgs` y `list` en `web/lib/downloads/` añaden `--cookies-from-browser` o
   `--cookies` si están definidas. Solo en local, como el resto de Descargas.
3. Botón «Mis Me gusta» en la página, que rellena el enlace `list=LM`.
4. Probar que relanzarla baja solo lo nuevo (el `--download-archive` ya lo hace).

**Riesgos a tener en cuenta:**

- Las cookies dan acceso completo a la cuenta de Google: que no salgan del ordenador
  ni acaben en logs.
- Descargar con la sesión iniciada en muchas peticiones puede hacer que YouTube marque
  la cuenta. Mejor ir con calma (`--sleep-interval`) y quizás usar una cuenta
  secundaria con los mismos Me gusta.

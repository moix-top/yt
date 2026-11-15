import { describe, expect, it } from "vitest";
import { buildArgs, isValidQuality, needsLogin, parseLine, parseSourceUrl } from "@/lib/downloads/options";

describe("parseSourceUrl", () => {
  it.each([
    ["https://music.youtube.com/playlist?list=PL123", true],
    ["https://www.youtube.com/playlist?list=PL123", true],
    ["https://youtu.be/dQw4w9WgXcQ", true],
    ["http://music.youtube.com/playlist?list=PL123", false],
    ["https://example.com/playlist?list=PL123", false],
    ["--exec rm", false],
  ])("%s", (input, ok) => expect(parseSourceUrl(input) !== null).toBe(ok));
});

describe("isValidQuality", () => {
  it("solo calidades de la lista de su formato", () => {
    expect(isValidQuality("mp3", "320")).toBe(true);
    expect(isValidQuality("mp4", "1080")).toBe(true);
    expect(isValidQuality("mp3", "1080")).toBe(false);
    expect(isValidQuality("flac", "320")).toBe(false);
  });
});

describe("buildArgs", () => {
  const url = "https://music.youtube.com/playlist?list=PL123";

  it("MP3 con la calidad pedida y el enlace tras --", () => {
    const a = buildArgs(url, "mp3", "192", "/d");
    expect(a).toEqual(expect.arrayContaining(["-x", "--audio-format", "mp3", "--audio-quality", "192K"]));
    expect(a.slice(-2)).toEqual(["--", url]);
    expect(a).toContain("/d/.descargados-mp3-192.txt");
  });

  it("sincronización: todo en la carpeta, sin numerar, con su archivo de descargadas", () => {
    const a = buildArgs(url, "mp3", "320", "/m/Favoritas", "sync");
    expect(a[a.indexOf("-o") + 1]).toBe("%(title)s.%(ext)s");
    // Se trabaja en una carpeta temporal y solo se mueve lo terminado.
    expect(a).toEqual(expect.arrayContaining(["-P", "home:/m/Favoritas", "-P", "temp:/m/Favoritas/.yt-sync-tmp"]));
    expect(a[a.indexOf("--download-archive") + 1]).toBe("/m/Favoritas/.yt-sync-archive.txt");
  });

  it("las opciones de sesión van antes del enlace", () => {
    const a = buildArgs(url, "mp3", "320", "/d", "sync", ["--cookies-from-browser", "brave"]);
    expect(a.indexOf("--cookies-from-browser")).toBeLessThan(a.indexOf("--"));
  });

  it("MP4 limita la altura y une en mp4", () => {
    const a = buildArgs(url, "mp4", "720", "/d");
    expect(a[a.indexOf("-f") + 1]).toContain("height<=720");
    expect(a).toEqual(expect.arrayContaining(["--merge-output-format", "mp4"]));
    expect(buildArgs(url, "mp4", "best", "/d")[a.indexOf("-f") + 1]).not.toContain("height");
  });
});

describe("needsLogin", () => {
  it.each([
    ["[youtube:tab] LM: YouTube said: The playlist does not exist.", true],
    ["[youtube] abc: Private video. Sign in if you've been granted access", true],
    ["unable to download video data: HTTP Error 403: Forbidden", false],
  ])("%s", (msg, expected) => expect(needsLogin(msg)).toBe(expected));
});

describe("parseLine", () => {
  it.each([
    ["@@S fOT0BUpITw8", { kind: "start", id: "fOT0BUpITw8" }],
    ["@@P fOT0BUpITw8  42.5%", { kind: "progress", id: "fOT0BUpITw8", pct: 42.5 }],
    ["@@D fOT0BUpITw8 /d/Lista/001 - A b.mp3", { kind: "done", id: "fOT0BUpITw8", file: "/d/Lista/001 - A b.mp3" }],
    [
      "[download] fOT0BUpITw8: BELLAKEO (Video Oficial) - Peso Pluma has already been recorded in the archive",
      { kind: "skipped", id: "fOT0BUpITw8" },
    ],
    [
      "ERROR: [youtube] fOT0BUpITw8: Video unavailable",
      { kind: "error", id: "fOT0BUpITw8", message: "Video unavailable" },
    ],
    [
      "ERROR: unable to download video data: HTTP Error 403: Forbidden",
      { kind: "error", id: null, message: "unable to download video data: HTTP Error 403: Forbidden" },
    ],
    ["[youtube] Extracting URL", null],
  ])("%s", (line, ev) => expect(parseLine(line)).toEqual(ev));
});

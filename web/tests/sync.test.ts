import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, setStore } from "@/lib/dynamo";
import { mergeVideo, parseVideoId, sanitizePatch } from "@/lib/merge";
import {
  createToken,
  listTokens,
  listVideos,
  resolveToken,
  revokeToken,
  sync,
} from "@/lib/services/videoService";

const ID = "dQw4w9WgXcQ";

beforeEach(() => setStore(new MemoryStore()));

describe("parseVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", ID],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", ID],
    ["youtube.com/shorts/dQw4w9WgXcQ", ID],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", ID],
    [ID, ID],
    ["https://example.com/watch?v=dQw4w9WgXcQ", null],
    ["no es un enlace", null],
  ])("%s", (input, expected) => expect(parseVideoId(input)).toBe(expected));
});

describe("mergeVideo", () => {
  it("cada grupo gana por su propio reloj", () => {
    const a = mergeVideo(null, { videoId: ID, positionSec: 100, positionAt: 10, queued: true, queuedAt: 50 }, 1);
    // El móvil manda una posición más nueva y un "por ver" más viejo.
    const b = mergeVideo(a, { videoId: ID, positionSec: 200, positionAt: 20, queued: false, queuedAt: 40 }, 2);
    expect(b.positionSec).toBe(200);
    expect(b.queued).toBe(true);
  });

  it("reenviar el mismo cambio es idempotente", () => {
    const a = mergeVideo(null, { videoId: ID, positionSec: 5, positionAt: 10 }, 1);
    const b = mergeVideo(a, { videoId: ID, positionSec: 9, positionAt: 10 }, 2);
    expect(b.positionSec).toBe(5);
  });
});

describe("sanitizePatch", () => {
  it("rechaza un valor sin su reloj", () => {
    expect(() => sanitizePatch({ videoId: ID, positionSec: 5 })).toThrow();
  });
  it("descarta campos desconocidos (pk/sk inyectados)", () => {
    const p = sanitizePatch({ videoId: ID, pk: "USER#otro", sk: "x" }) as Record<string, unknown>;
    expect(p.pk).toBeUndefined();
    expect(p.sk).toBeUndefined();
  });
  it("rechaza ids que no son de YouTube", () => {
    expect(() => sanitizePatch({ videoId: "VIDEO#x#y" })).toThrow();
  });
});

describe("sync", () => {
  it("devuelve solo lo cambiado desde el cursor", async () => {
    const r1 = await sync("a@x.com", { since: 0, changes: [{ videoId: ID, queued: true, queuedAt: 1 }] });
    expect(r1.videos).toHaveLength(1);
    const r2 = await sync("a@x.com", { since: r1.now, changes: [] });
    expect(r2.videos).toHaveLength(0);
  });

  it("aísla a los usuarios", async () => {
    await sync("a@x.com", { since: 0, changes: [{ videoId: ID, queued: true, queuedAt: 1 }] });
    expect(await listVideos("b@x.com")).toHaveLength(0);
  });
});

describe("tokens", () => {
  it("un token resuelve a su usuario y deja de valer al revocarlo", async () => {
    const token = await createToken("a@x.com", "Pixel");
    expect(await resolveToken(token)).toBe("a@x.com");
    const [t] = await listTokens("a@x.com");
    // Otro usuario no puede revocarlo aunque conozca el id.
    await expect(revokeToken("b@x.com", t.id)).rejects.toThrow();
    await revokeToken("a@x.com", t.id);
    expect(await resolveToken(token)).toBeNull();
  });

  it("un token inventado no vale", async () => {
    expect(await resolveToken("yt_inventado")).toBeNull();
  });
});

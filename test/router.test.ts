import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionFrom, credentialFor, discoverModels, displayText, mapCatalogue, normalizeUrl } from "../src/router.ts";
import { responseStatus } from "../src/index.ts";

test("router roots, /v1 URLs, and reverse-proxy prefixes normalize once", () => {
  assert.equal(normalizeUrl(" https://router.example/ "), "https://router.example/v1");
  assert.equal(normalizeUrl("http://localhost:8585/v1/"), "http://localhost:8585/v1");
  assert.equal(normalizeUrl("https://router.example/team/router"), "https://router.example/team/router/v1");
  for (const bad of ["localhost:8585", "ftp://router.example", "https://key@router.example", "https://router.example?key=secret", "https://router.example/#x", "https://router.example/v1/models"]) assert.throws(() => normalizeUrl(bad));
});

test("stored credentials keep their router URL and take precedence over environment", async () => {
  const stored = credentialFor({ baseUrl: "https://stored.example/v1", apiKey: "stored-key" });
  assert.deepEqual(await connectionFrom(stored, async () => "environment-value"), { baseUrl: "https://stored.example/v1", apiKey: "stored-key" });
  assert.equal(await connectionFrom(undefined, () => undefined), undefined);
  assert.deepEqual(await connectionFrom(undefined, (key) => ({ DISCRIMIN_URL: "https://env.example", DISCRIMIN_API_KEY: "env-key" })[key]), { baseUrl: "https://env.example/v1", apiKey: "env-key" });
});

test("catalogue maps measured limits and capabilities; Auto leaves thinking to router", () => {
  const models = mapCatalogue({ data: [
    { id: "qwen", features: ["chat", "thinking", "vision", "tools"], context_length: 196_608, max_output_tokens: 12_000 },
    { id: "default", features: ["chat", "thinking", "tools"], context_length: 262_144 },
    { id: "embedding", features: ["embeddings"] },
    { id: "bad\nmodel" },
  ] }, "https://router.example/v1");
  assert.deepEqual(models.map((model) => model.id), ["default", "qwen"]);
  assert.equal(models[0].reasoning, false);
  assert.equal(models[0].compat?.supportsReasoningEffort, false);
  assert.equal(models[0].contextWindow, 262_144);
  assert.equal(models[1].maxTokens, 12_000);
  assert.equal(models[1].reasoning, true);
  assert.deepEqual(models[1].input, ["text", "image"]);
});

test("missing limits use documented conservative defaults; duplicate models collapse", () => {
  const models = mapCatalogue({ data: [{ id: "one" }, { id: "one" }, { id: "tiny", context_length: 4096 }] }, "http://router/v1");
  assert.equal(models.length, 2);
  assert.equal(models[0].contextWindow, 32_768);
  assert.equal(models[1].maxTokens, 1024);
  assert.throws(() => mapCatalogue({}, ""), /catalogue/);
  assert.throws(() => mapCatalogue({ data: [] }, ""), /no chat models/);
});

test("discovery sends a bearer key, refuses redirects, and never echoes error bodies", async () => {
  const connection = { baseUrl: "https://router.example/v1", apiKey: "private-key" };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://router.example/v1/models");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-key");
    assert.equal(init?.redirect, "error");
    return Response.json({ data: [{ id: "default" }] });
  };
  assert.equal((await discoverModels(connection, undefined, fetcher))[0].id, "default");
  await assert.rejects(discoverModels(connection, undefined, async () => new Response("private-key", { status: 401 })), /authentication failed/);
  await assert.rejects(discoverModels(connection, undefined, async () => new Response("private-key", { status: 500 })), (error: Error) => error.message.includes("HTTP 500") && !error.message.includes("private-key"));
  await assert.rejects(discoverModels(connection, undefined, async () => new Response("<html>")), /invalid JSON/);
});

test("discovery responds to cancellation and timeout", async () => {
  const stalled: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
    if (init?.signal?.aborted) reject(init.signal.reason);
    else init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  const connection = { baseUrl: "http://router/v1", apiKey: "key" };
  await assert.rejects(discoverModels(connection, AbortSignal.abort(), stalled), /cancelled/);
  // AbortSignal.timeout is unref'ed; a socket normally keeps the event loop alive.
  const keepAlive = setInterval(() => {}, 100);
  try { await assert.rejects(discoverModels(connection, undefined, stalled, 10), /timed out/); }
  finally { clearInterval(keepAlive); }
});

test("footer prefers the human name, handles missing headers and failures, strips terminal escapes", () => {
  assert.equal(responseStatus({ "X-LLM-Backend-Model-Name": "Qwen", "X-LLM-Backend-Model": "path/model.gguf" }, "default", 200), "Discrimin · Auto → Qwen");
  assert.equal(responseStatus({}, "default", 200), "Discrimin · Auto → backend unreported");
  assert.equal(responseStatus({ "x-llm-backend-model": "ornith" }, "ornith", 503), "Discrimin · ornith · HTTP 503 · ornith");
  assert.equal(displayText("\x1b[31mQwen\x1b[0m\n\u202e"), "Qwen");
  assert.equal(displayText("x".repeat(200)).length, 72);
});

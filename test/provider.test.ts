import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, type Credential, type RefreshModelsContext } from "@earendil-works/pi-ai";
import { createDiscrimenProvider, primeProvider } from "../src/provider.ts";
import { credentialFor } from "../src/router.ts";

const credential = credentialFor({ baseUrl: "http://router/v1", apiKey: "key" });
const refreshContext = (overrides: Partial<RefreshModelsContext> = {}): RefreshModelsContext => ({
  credential, allowNetwork: true, signal: new AbortController().signal,
  async publish(publication) { publication.update?.(); return true; }, ...overrides,
});

test("native login asks for a masked key, validates before returning a credential, and reuses its catalogue", async () => {
  let requests = 0;
  const prompts: string[] = [];
  const notifications: string[] = [];
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => { requests++; return Response.json({ data: [{ id: "default" }, { id: "qwen" }] }); } });
  const result = await provider.auth.apiKey!.login!({
    signal: new AbortController().signal,
    async prompt(prompt) { prompts.push(prompt.type); return prompt.type === "secret" ? "key" : "http://router"; },
    notify(event) { if (event.type === "info") notifications.push(event.message); },
  });
  assert.deepEqual(prompts, ["text", "secret"]);
  assert.deepEqual(result, credential);
  assert.equal(notifications.some((message) => message.includes("key")), false);
  await provider.refreshModels!(refreshContext({ credential: result, allowNetwork: false }));
  assert.deepEqual(provider.getModels().map((model) => model.id), ["default", "qwen"]);
  assert.equal(requests, 1);
});

test("failed and cancelled login never returns credentials", async () => {
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => new Response("bad", { status: 403 }) });
  await assert.rejects(provider.auth.apiKey!.login!({ signal: new AbortController().signal, prompt: async (prompt) => prompt.type === "secret" ? "key" : "http://router", notify() {} }), /authentication failed/);
  await assert.rejects(provider.auth.apiKey!.login!({ signal: new AbortController().signal, prompt: async () => { throw new Error("cancelled"); }, notify() {} }), /cancelled/);
  assert.deepEqual(provider.getModels().map((model) => model.id), ["default"]);
});

test("Pi's model runtime persists the native login and resolves the saved endpoint", async () => {
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => Response.json({ data: [{ id: "default" }, { id: "saved-model" }] }) });
  const runtime = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  runtime.setProvider(provider);
  await runtime.login("discrimen", "api_key", {
    prompt: async (prompt) => prompt.type === "secret" ? "saved-key" : "https://saved.example/prefix",
    notify() {},
  });
  const result = await runtime.refresh({ providers: ["discrimen"], allowNetwork: false });
  assert.equal(result.errors.size, 0);
  assert.deepEqual((await runtime.getAuth("discrimen"))?.auth, { apiKey: "saved-key", baseUrl: "https://saved.example/prefix/v1" });
  assert.ok(runtime.getModel("discrimen", "saved-model"));
  await runtime.logout("discrimen");
  assert.equal(await runtime.getAuth("discrimen"), undefined);
});

test("discovery refreshes additions/removals, caches briefly, and retains a good catalogue during outages", async () => {
  let body = [{ id: "default" }, { id: "old" }];
  let calls = 0;
  let failing = false;
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => {
    calls++;
    if (failing) throw new TypeError("network down");
    return Response.json({ data: body });
  } });
  await primeProvider(provider, credential);
  await provider.refreshModels!(refreshContext());
  assert.equal(calls, 1);
  body = [{ id: "default" }, { id: "new" }];
  await provider.refreshModels!(refreshContext({ force: true }));
  assert.deepEqual(provider.getModels().map((model) => model.id), ["default", "new"]);
  failing = true;
  await assert.rejects(provider.refreshModels!(refreshContext({ force: true })), /Cannot reach/);
  assert.deepEqual(provider.getModels().map((model) => model.id), ["default", "new"]);
});

test("switching router or logging out clears the previous fleet", async () => {
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => Response.json({ data: [{ id: "default" }, { id: "private-model" }] }) });
  await primeProvider(provider, credential);
  await provider.refreshModels!(refreshContext({ credential: credentialFor({ baseUrl: "http://other/v1", apiKey: "other" }), allowNetwork: false }));
  assert.deepEqual(provider.getModels().map((model) => model.id), ["default"]);
  assert.equal(provider.getModels()[0].baseUrl, "http://other/v1");
  await provider.refreshModels!(refreshContext({ credential: undefined, allowNetwork: false }));
  assert.deepEqual(provider.getModels().map((model) => model.id), ["default"]);
});

test("a superseded refresh cannot publish its result", async () => {
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => Response.json({ data: [{ id: "default" }, { id: "new" }] }) });
  await provider.refreshModels!(refreshContext({ publish: async () => false }));
  assert.deepEqual(provider.getModels().map((model) => model.id), ["default"]);
});

test("request authentication sends the effective key and URL, and is unavailable before setup", async () => {
  const provider = createDiscrimenProvider({ env: () => undefined });
  const ctx = { env: async () => undefined, fileExists: async () => false };
  const signal = new AbortController().signal;
  assert.equal(await provider.auth.apiKey!.resolve({ ctx, signal }), undefined);
  const resolved = await provider.auth.apiKey!.resolve({ credential: credential as Extract<Credential, { type: "api_key" }>, ctx, signal });
  assert.deepEqual(resolved?.auth, { apiKey: "key", baseUrl: "http://router/v1" });
});

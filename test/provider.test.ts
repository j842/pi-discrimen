import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, type Credential, type RefreshModelsContext } from "@earendil-works/pi-ai";
import { createDiscrimenProvider, primeProvider, requestTimeoutMs } from "../src/provider.ts";
import { credentialFor } from "../src/router.ts";

const credential = credentialFor({ baseUrl: "http://router/v1", apiKey: "key" });
const refreshContext = (overrides: Partial<RefreshModelsContext> = {}): RefreshModelsContext => ({
  credential, allowNetwork: true, signal: new AbortController().signal,
  async publish(publication) { publication.update?.(); return true; }, ...overrides,
});

test("request timeout replaces only the stock default and honours explicit settings including disabled timeouts", () => {
  assert.equal(requestTimeoutMs(undefined, {}), 600_000);
  assert.equal(requestTimeoutMs(300_000, {}), 600_000);
  assert.equal(requestTimeoutMs(900_000, {}), 900_000);
  assert.equal(requestTimeoutMs(10_000, {}), 10_000);
  assert.equal(requestTimeoutMs(300_000, { httpIdleTimeoutMs: 300_000 }), 300_000);
  assert.equal(requestTimeoutMs(1_800_000, { httpIdleTimeoutMs: 1_800_000 }), 1_800_000);
  assert.equal(requestTimeoutMs(2_147_483_647, { httpIdleTimeoutMs: 0 }), 2_147_483_647);
  assert.equal(requestTimeoutMs(0, { retry: { provider: { timeoutMs: 0 } } }), 0);
  assert.equal(requestTimeoutMs(300_000, { retry: { provider: { timeoutMs: 300_000 } } }), 300_000);
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

test("network refresh after native login retains the saved router URL and discovers catalogue changes", async () => {
  const urls: string[] = [];
  let model = "before-refresh";
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async (input) => {
    urls.push(String(input));
    return Response.json({ data: [{ id: "default" }, { id: model }] });
  } });
  const runtime = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  runtime.setProvider(provider);
  await runtime.login("discrimen", "api_key", {
    prompt: async (prompt) => prompt.type === "secret" ? "saved-key" : "https://saved.example/prefix",
    notify() {},
  });
  await runtime.refresh({ providers: ["discrimen"], allowNetwork: false });
  assert.ok(runtime.getModel("discrimen", "before-refresh"));
  model = "after-refresh";
  const result = await runtime.refresh({ providers: ["discrimen"], allowNetwork: true, force: true });
  assert.equal(result.errors.size, 0);
  assert.equal(result.aborted, false);
  assert.deepEqual(runtime.getModels("discrimen").map((model) => model.id), ["default", "after-refresh"]);
  assert.deepEqual(urls, ["https://saved.example/prefix/v1/models", "https://saved.example/prefix/v1/models"]);
});

test("each model-picker refresh discovers changes even immediately after login", async () => {
  let model = "before-picker";
  let requests = 0;
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => {
    requests++;
    return Response.json({ data: [{ id: "default" }, { id: model }] });
  } });
  const runtime = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  runtime.setProvider(provider);
  await runtime.login("discrimen", "api_key", {
    prompt: async (prompt) => prompt.type === "secret" ? "saved-key" : "https://saved.example",
    notify() {},
  });
  for (const next of ["first-picker", "second-picker"]) {
    model = next;
    // Pi's model picker requests a normal refresh, without force.
    const result = await runtime.refresh();
    assert.equal(result.errors.size, 0);
    assert.deepEqual(runtime.getModels("discrimen").map((model) => model.id), ["default", next]);
  }
  assert.equal(requests, 3);
});

test("discovery refreshes additions/removals, reuses offline state, and retains a good catalogue during outages", async () => {
  let body = [{ id: "default" }, { id: "old" }];
  let calls = 0;
  let failing = false;
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => {
    calls++;
    if (failing) throw new TypeError("network down");
    return Response.json({ data: body });
  } });
  await primeProvider(provider, credential);
  await provider.refreshModels!(refreshContext({ allowNetwork: false }));
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

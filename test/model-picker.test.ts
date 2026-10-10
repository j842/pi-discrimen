import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createDiscrimenProvider } from "../src/provider.ts";

test("opening Pi's model picker refreshes a saved login and preserves models during an outage", async () => {
  // Exercise the real picker; its internal component is not a package export.
  const host = await realpath(new URL("../node_modules/@earendil-works/pi-coding-agent", import.meta.url));
  const { ModelSelectorComponent } = await import(pathToFileURL(join(host, "dist/modes/interactive/components/model-selector.js")).href);
  const { initTheme } = await import(pathToFileURL(join(host, "dist/modes/interactive/theme/theme.js")).href);
  initTheme("dark");
  let model = "login-model";
  let failing = false;
  const provider = createDiscrimenProvider({ env: () => undefined, fetcher: async () => {
    if (failing) throw new TypeError("router unavailable");
    return Response.json({ data: [{ id: "default" }, { id: model }] });
  } });
  const runtime = await ModelRuntime.create({ modelsPath: null, credentials: new InMemoryCredentialStore(), refreshOnCreate: false });
  runtime.registerNativeProvider(provider);
  await runtime.refresh({ allowNetwork: false });
  await runtime.login("discrimen", "api_key", {
    prompt: async (prompt) => prompt.type === "secret" ? "saved-key" : "https://saved.example",
    notify() {},
  });
  // Limit the picker to the provider under test; never contact other providers.
  const pickerRuntime = {
    getAvailableSnapshot: () => runtime.getAvailableSnapshot().filter((model) => model.provider === "discrimen"),
    getModel: runtime.getModel.bind(runtime),
    getError: runtime.getError.bind(runtime),
    refresh: (options: { signal?: AbortSignal }) => runtime.refresh({ ...options, providers: ["discrimen"] }),
  };
  const openPicker = async () => {
    let selector: InstanceType<typeof ModelSelectorComponent> | undefined;
    let completed!: () => void;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const refreshed = new Promise<void>((resolve, reject) => {
      completed = resolve;
      deadline = setTimeout(() => reject(new Error("Picker did not finish refreshing")), 5_000);
    });
    try {
      selector = new ModelSelectorComponent({ requestRender() { if (selector) completed(); } },
        runtime.getModel("discrimen", "default"), pickerRuntime, [], () => {}, () => {});
      await refreshed;
      return selector.render(120).join("\n");
    } finally {
      clearTimeout(deadline);
      selector?.dispose();
    }
  };
  for (const next of ["first-picker-model", "second-picker-model"]) {
    const previous = model;
    model = next;
    const rendered = await openPicker();
    assert.match(rendered, new RegExp(next));
    assert.doesNotMatch(rendered, new RegExp(previous));
    assert.deepEqual(runtime.getModels("discrimen").map((model) => model.id), ["default", next]);
  }
  failing = true;
  const offline = await openPicker();
  assert.match(offline, /second-picker-model/);
  assert.match(offline, /Could not refresh discrimen; showing cached models/);
});

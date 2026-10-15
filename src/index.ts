import { readStoredCredential, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDiscrimenProvider, primeProvider, requestTimeoutMs } from "./provider.ts";
import { displayText, PROVIDER } from "./router.ts";

export function responseStatus(headers: Record<string, string>, selection: string, status: number): string {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const model = normalized["x-llm-backend-model-name"] || normalized["x-llm-backend-model"];
  const mode = selection === "default" ? "Auto" : selection === "expert" ? "Expert" : displayText(selection);
  const prefix = `Discrimen · ${mode}`;
  if (status >= 400) return `${prefix} · HTTP ${status}${model ? ` · ${displayText(model)}` : ""}`;
  return `${prefix} → ${model ? displayText(model) : "backend unreported"}`;
}

export default async function discrimen(pi: ExtensionAPI) {
  const provider = createDiscrimenProvider({ requestTimeoutMs: (current) => requestTimeoutMs(current, pi.getSettings()) });
  let startupError: string | undefined;
  try { await primeProvider(provider, readStoredCredential(PROVIDER)); }
  catch (error) { startupError = error instanceof Error ? error.message : "Router discovery failed."; }
  pi.registerProvider(provider);

  const selectedStatus = (ctx: ExtensionContext, suffix = "") => {
    ctx.ui.setStatus(PROVIDER, ctx.model?.provider === PROVIDER
      ? `Discrimen · ${ctx.model.id === "default" ? "Auto" : displayText(ctx.model.id)}${suffix}`
      : undefined);
  };
  pi.on("session_start", (_event, ctx) => {
    selectedStatus(ctx);
    if (startupError && ctx.hasUI) ctx.ui.notify(`Discrimen: ${startupError}`, "warning");
  });
  pi.on("model_select", (_event, ctx) => selectedStatus(ctx));
  pi.on("before_provider_request", (_event, ctx) => selectedStatus(ctx, " · routing…"));
  pi.on("after_provider_response", (event, ctx) => {
    if (ctx.model?.provider === PROVIDER) ctx.ui.setStatus(PROVIDER, responseStatus(event.headers, ctx.model.id, event.status));
  });

  pi.registerCommand("discrimen", {
    description: "Discrimen router: auto, refresh, status (connect with /login discrimen)",
    getArgumentCompletions(prefix) {
      return ["auto", "refresh", "status"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
    },
    async handler(args, ctx) {
      const action = args.trim() || "status";
      if (!["auto", "refresh", "status"].includes(action)) {
        ctx.ui.notify("Use /login discrimen to connect; /discrimen auto, refresh, or status.", "info");
        return;
      }
      try {
        const auth = await ctx.modelRegistry.getProviderAuth(PROVIDER);
        if (!auth) {
          ctx.ui.notify("Connect with /login discrimen, or set DISCRIMEN_URL and DISCRIMEN_API_KEY.", "info");
          return;
        }
        if (action === "refresh" || action === "auto") {
          await ctx.waitForIdle();
          const result = await ctx.modelRegistry.refresh({ providers: [PROVIDER], allowNetwork: true, force: action === "refresh" });
          const error = result.errors.get(PROVIDER);
          if (error) throw error;
          if (result.aborted) throw new Error("Model refresh was cancelled.");
          if (action === "auto") {
            const model = ctx.modelRegistry.find(PROVIDER, "default");
            if (!model || !await pi.setModel(model)) throw new Error("Connect first with /login discrimen, or set DISCRIMEN_URL and DISCRIMEN_API_KEY.");
            ctx.ui.notify("Discrimen Auto selected. In /model, press Ctrl+S to save it as your default.", "info");
            return;
          }
          if (ctx.model?.provider === PROVIDER) {
            const updated = ctx.modelRegistry.find(PROVIDER, ctx.model.id);
            if (updated) await pi.setModel(updated);
            else ctx.ui.notify("The selected model has left the catalogue. Use /model or /discrimen auto to choose another.", "warning");
          }
          ctx.ui.notify(`Discrimen: refreshed ${provider.getModels().length} models. Open /model to choose one.`, "info");
          return;
        }
        ctx.ui.notify(`Discrimen: ${displayText(auth.auth.baseUrl ?? "configured router", 160)} · ${provider.getModels().length} models. /discrimen refresh updates the list; /discrimen auto enables routing.`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Discrimen command failed.", "error");
      }
    },
  });
}

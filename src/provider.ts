import { createProvider, type Credential, type Provider, type RefreshModelsContext } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { connectionFrom, credentialFor, discoverModels, fallbackModel, normalizeUrl, PROVIDER, type Connection, type Environment, type RouterModel } from "./router.ts";

export interface ProviderOptions { env?: Environment; fetcher?: typeof fetch }

export function createDiscrimenProvider(options: ProviderOptions = {}): Provider<"openai-completions"> {
  const env = options.env ?? ((name: string) => process.env[name]);
  let models: RouterModel[] = [fallbackModel()];
  let cache: { connection: Connection; models: RouterModel[] } | undefined;
  const sameConnection = (a: Connection, b: Connection) => a.baseUrl === b.baseUrl && a.apiKey === b.apiKey;
  const fetchCatalogue = async (connection: Connection, signal?: AbortSignal) => {
    const discovered = await discoverModels(connection, signal, options.fetcher);
    return { connection, models: discovered };
  };
  const provider = createProvider<"openai-completions">({
    id: PROVIDER,
    name: "Discrimen",
    models: [],
    // Pi supplies this module to installed extensions, including standalone
    // archives. Direct dynamic imports of /api/* require a local node_modules.
    api: openAICompletionsApi(),
    auth: {
      apiKey: {
        name: "Discrimen router API key",
        async login(interaction) {
          const baseUrl = normalizeUrl(await interaction.prompt({ type: "text", message: "Router URL (root or /v1)", placeholder: await env("DISCRIMEN_URL") ?? "https://router.example.com" }));
          const key = await interaction.prompt({ type: "secret", message: "Client API key" });
          const connection = await connectionFrom(credentialFor({ baseUrl, apiKey: key }), env);
          if (!connection) throw new Error("An API key is required.");
          interaction.notify({ type: "info", message: "Checking the router and discovering models…" });
          const result = await fetchCatalogue(connection, interaction.signal);
          // Pi commits the credential after login returns. refreshModels publishes
          // this verified catalogue once that credential becomes effective.
          cache = result;
          interaction.notify({ type: "info", message: `Connected: ${result.models.length} models. Use /discrimen auto or choose a model with /model.` });
          return credentialFor(connection);
        },
        async resolve({ credential, ctx, signal }) {
          signal.throwIfAborted();
          const connection = await connectionFrom(credential, (name) => ctx.env(name));
          // Pi passes the resolved key and environment into network refreshes.
          // auth.baseUrl alone is not retained in that refresh credential.
          return connection ? {
            auth: { apiKey: connection.apiKey, baseUrl: connection.baseUrl },
            env: { DISCRIMEN_URL: connection.baseUrl },
            source: credential?.key ? "Stored Discrimen key" : "DISCRIMEN_API_KEY",
          } : undefined;
        },
      },
    },
  });
  provider.getModels = () => models;
  provider.getAllModels = () => models;
  provider.refreshModels = async (context: RefreshModelsContext) => {
    const connection = await connectionFrom(context.credential, env);
    if (!connection) {
      await context.publish({ update: () => { models = [fallbackModel()]; cache = undefined; } });
      return;
    }
    const matches = cache && sameConnection(cache.connection, connection);
    if (matches && !context.allowNetwork) {
      const cached = cache!;
      await context.publish({ update: () => { models = cached.models; } });
      return;
    }
    if (!matches) {
      const accepted = await context.publish({ update: () => { models = [{ ...fallbackModel(), baseUrl: connection.baseUrl }]; } });
      if (!accepted) return;
    }
    if (!context.allowNetwork) return;
    const result = await fetchCatalogue(connection, context.signal);
    await context.publish({ update: () => { models = result.models; cache = result; } });
  };
  return provider;
}

/** Pi waits for async extension factories, including --list-models startup. */
export async function primeProvider(provider: Provider, credential?: Credential): Promise<void> {
  await provider.refreshModels?.({
    credential,
    allowNetwork: true,
    signal: new AbortController().signal,
    async publish(publication) { publication.update?.(); return true; },
  });
}

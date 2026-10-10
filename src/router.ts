import type { ApiKeyCredential, Credential, Model } from "@earendil-works/pi-ai";

export const PROVIDER = "discrimin";
export const DISCOVERY_TIMEOUT_MS = 8_000;
export type RouterModel = Model<"openai-completions">;
export type Environment = (name: string) => string | undefined | Promise<string | undefined>;
export interface Connection { baseUrl: string; apiKey: string }

/** Accept the router root or its /v1 URL, including reverse-proxy prefixes. */
export function normalizeUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a complete router URL, including http:// or https://."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) router URL without credentials, a query, or a fragment.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(models|chat\/completions|completions)$/.test(path)) {
    throw new Error("Enter the router root or /v1 URL, not an individual API endpoint.");
  }
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
  return url.toString().replace(/\/$/, "");
}

export async function connectionFrom(credential: Credential | undefined, env: Environment): Promise<Connection | undefined> {
  const stored = credential?.type === "api_key" ? credential : undefined;
  const url = stored?.env?.DISCRIMIN_URL ?? await env("DISCRIMIN_URL");
  const key = stored?.key ?? await env("DISCRIMIN_API_KEY");
  if (!url || !key?.trim()) return undefined;
  if (/[\r\n]/.test(key)) throw new Error("The API key must be a single line.");
  return { baseUrl: normalizeUrl(url), apiKey: key.trim() };
}

export function credentialFor(connection: Connection): ApiKeyCredential {
  return { type: "api_key", key: connection.apiKey, env: { DISCRIMIN_URL: connection.baseUrl } };
}

/** Server-provided text is untrusted terminal output. */
export function displayText(value: string, limit = 72): string {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, limit);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function mapCatalogue(payload: unknown, baseUrl: string): RouterModel[] {
  if (!record(payload) || !Array.isArray(payload.data)) throw new Error("The router did not return a /v1/models catalogue.");
  const models = new Map<string, RouterModel>();
  for (const entry of payload.data) {
    if (!record(entry) || typeof entry.id !== "string" || !entry.id.trim() || /[\x00-\x20\x7f-\x9f]/.test(entry.id)) continue;
    const features = Array.isArray(entry.features) ? entry.features : [];
    if (features.includes("embeddings") && !features.includes("chat")) continue;
    const automatic = entry.id === "default" || entry.id === "expert";
    const contextWindow = positiveInteger(entry.context_length) ?? 32_768;
    const outputLimit = positiveInteger(entry.max_output_tokens) ?? positiveInteger(entry.max_tokens) ?? 8_192;
    models.set(entry.id, {
      id: entry.id,
      name: entry.id === "default" ? "Discrimin — Auto" : entry.id === "expert" ? "Discrimin — Expert" : displayText(typeof entry.name === "string" ? entry.name : entry.id),
      api: "openai-completions",
      provider: PROVIDER,
      baseUrl,
      // Automatic routes must omit reasoning_effort, including Pi's "none".
      reasoning: !automatic && features.includes("thinking"),
      thinkingLevelMap: { off: "none" },
      input: features.includes("vision") ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: Math.max(1, Math.min(outputLimit, Math.floor(contextWindow / 4))),
      compat: { maxTokensField: "max_tokens", supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: !automatic },
    });
  }
  if (!models.size) throw new Error("The router returned no chat models.");
  return [...models.values()].sort((a, b) => a.id === "default" ? -1 : b.id === "default" ? 1 : a.id.localeCompare(b.id));
}

export function fallbackModel(): RouterModel {
  return mapCatalogue({ data: [{ id: "default" }] }, "http://localhost:8585/v1")[0]!;
}

export async function discoverModels(connection: Connection, signal?: AbortSignal, fetcher: typeof fetch = fetch, timeoutMs = DISCOVERY_TIMEOUT_MS): Promise<RouterModel[]> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetcher(`${connection.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${connection.apiKey}`, Accept: "application/json" },
      redirect: "error",
      signal: combined,
    });
    if (response.status === 401 || response.status === 403) throw new Error("Router authentication failed. Run /login discrimin with a client API key.");
    if (!response.ok) throw new Error(`Router model discovery failed (HTTP ${response.status}). Check the URL and router availability.`);
    let payload: unknown;
    try { payload = await response.json(); } catch {
      combined.throwIfAborted();
      throw new Error("The router returned invalid JSON from /v1/models.");
    }
    return mapCatalogue(payload, connection.baseUrl);
  } catch (error) {
    if (signal?.aborted) throw new Error("Router model discovery was cancelled.");
    if (deadline.aborted) throw new Error("Router model discovery timed out. Check your network or VPN connection.");
    if (error instanceof TypeError) throw new Error("Cannot reach the router. Check its URL and your network or VPN connection.");
    throw error;
  }
}

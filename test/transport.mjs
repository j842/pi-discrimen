// Test-only HTTP transport. Pi's actual OpenAI adapter and SSE parser consume it.
import { appendFileSync } from "node:fs";

export default function installTransport() {
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== "https://discrimin.test") throw new TypeError("Network disabled in fixture");
  if (request.headers.get("authorization") !== "Bearer test-client-key") return new Response("", { status: 401 });
  if (url.pathname === "/v1/models") {
    return Response.json({ data: [
      { id: "default", features: ["chat", "tools", "thinking"], context_length: 131072 },
      { id: "test-qwen", features: ["chat", "tools", "thinking"], context_length: 65536 },
    ] });
  }
  if (url.pathname !== "/v1/chat/completions") return new Response("", { status: 404 });
  const payload = await request.json();
  appendFileSync(process.cwd() + "/requests.jsonl", JSON.stringify(payload) + "\n");
  const second = payload.messages.some(message => message.role === "tool");
  const model = second ? "model-b" : "model-a";
  const frames = [];
  const send = (delta, finish_reason = null) => frames.push("data: " + JSON.stringify({ id: "fixture-response", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
  if (!second) {
    send({ role: "assistant", tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name: "read", arguments: JSON.stringify({ path: process.cwd() + "/fixture.txt" }) } }] });
    send({}, "tool_calls");
  } else {
    send({ role: "assistant", content: "Kia ora — fixture read successfully." });
    send({}, "stop");
  }
  frames.push("data: " + JSON.stringify({ id: "fixture-response", object: "chat.completion.chunk", created: 1, model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }) + "\n\n");
  frames.push("data: [DONE]\n\n");
  const bytes = new TextEncoder().encode(frames.join(""));
  let offset = 0;
  const body = new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + 7)); offset += 7;
  } });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "X-LLM-Backend-Model": model, "X-LLM-Backend-Model-Name": second ? "Fixture B" : "Fixture A" } });
};
}

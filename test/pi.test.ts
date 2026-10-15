import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("real Pi loads the package, discovers models, streams a tool round trip, and updates its footer", { timeout: 60_000 }, async () => {
  const work = await mkdtemp(join(tmpdir(), "pi-discrimen-test-"));
  try {
    // Exercise installation without the development node_modules tree on every run.
    const extensionPath = process.env.PI_DISCRIMEN_PACKAGE_UNDER_TEST ?? join(work, "package");
    if (!process.env.PI_DISCRIMEN_PACKAGE_UNDER_TEST) {
      await mkdir(extensionPath);
      const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      for (const path of [...manifest.files, "package.json"]) {
        await cp(join(root, path), join(extensionPath, path), { recursive: true });
      }
    }
    await writeFile(join(work, "fixture.txt"), "a harmless local test fixture");
    const observer = join(work, "observe.ts");
    await writeFile(observer, `import { appendFileSync } from "node:fs";
export default function(pi) {
  pi.on("session_start", async (_event, ctx) => {
    const result = await ctx.modelRegistry.refresh({ providers: ["discrimen"], allowNetwork: true, force: true });
    if (result.errors.size || !ctx.modelRegistry.find("discrimen", "test-qwen")) throw new Error("Saved-login catalogue refresh failed");
    const original = ctx.ui.setStatus.bind(ctx.ui);
    ctx.ui.setStatus = (key, value) => { appendFileSync(${JSON.stringify(join(work, "statuses.jsonl"))}, JSON.stringify({key, value}) + "\\n"); original(key, value); };
  });
}`);
    const packagePath = await realpath(join(root, "node_modules/@earendil-works/pi-coding-agent"));
    const cli = process.env.PI_DISCRIMEN_PI_CLI ?? join(packagePath, "dist/bundle/cli.js");
    const agentDir = join(work, "agent");
    await mkdir(agentDir);
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ discrimen: {
      type: "api_key", key: "test-client-key", env: { DISCRIMEN_URL: "https://discrimen.test/v1" },
    } }));
    const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, DISCRIMEN_URL: undefined, DISCRIMEN_API_KEY: undefined, NO_COLOR: "1" };
    const runPi = async (args: string[]) => {
      const outFile = join(work, "stdout.txt"), errFile = join(work, "stderr.txt");
      const out = openSync(outFile, "w"), err = openSync(errFile, "w");
      const child = spawn(process.execPath, [cli, "--no-extensions", "-e", join(root, "test/transport.mjs"), "-e", extensionPath, "--no-skills", "--no-prompt-templates", "--no-themes", "--no-approve", ...args], { cwd: work, env, stdio: ["ignore", out, err] });
      closeSync(out); closeSync(err);
      const deadline = setTimeout(() => child.kill(), 30_000);
      const [code] = await once(child, "close");
      clearTimeout(deadline);
      const stdout = await readFile(outFile, "utf8"), stderr = await readFile(errFile, "utf8");
      assert.equal(code, 0, `${stdout}\n${stderr}`);
      assert.doesNotMatch(stderr, /Error loading extension|Failed to load extension/);
      return { stdout, stderr };
    };
    const listed = await runPi(["--list-models", "discrimen"]);
    assert.match(listed.stdout, /test-qwen/, listed.stderr || "Pi returned no model listing");
    assert.match(listed.stdout, /default/);
    const answered = await runPi(["-e", observer, "--provider", "discrimen", "--model", "default", "--tools", "read", "--no-session", "--print", "Read the fixture."]);
    assert.match(answered.stdout, /Kia ora — fixture read successfully/);
    const requests = (await readFile(join(work, "requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.model, "default");
      assert.equal(request.stream, true);
      assert.equal(request.reasoning_effort, undefined);
      assert.equal(request.fit_max_tokens, true);
      assert.ok(request.max_tokens > 0);
    }
    const toolResult = requests[1].messages.find((message: any) => message.role === "tool");
    assert.match(JSON.stringify(toolResult), /harmless local test fixture/);
    const statuses = await readFile(join(work, "statuses.jsonl"), "utf8");
    assert.match(statuses, /Discrimen · Auto → Fixture A/);
    assert.match(statuses, /Discrimen · Auto → Fixture B/);
    assert.doesNotMatch(statuses, /test-client-key/);
    const timeoutValues = () => readFile(join(work, "timeouts.jsonl"), "utf8").then((text) => text.trim().split("\n").map((line) => JSON.parse(line)));
    assert.deepEqual(await timeoutValues(), ["600", "600"]);

    // No models.json or settings migration: updating the package supplies the
    // Flash Next profile even when the live catalogue omits `thinking`.
    const metadataObserver = join(work, "metadata.ts");
    await writeFile(metadataObserver, `import { writeFileSync } from "node:fs";
export default function(pi) {
  pi.on("session_start", (_event, ctx) => {
    writeFileSync(${JSON.stringify(join(work, "model.json"))}, JSON.stringify(ctx.model));
  });
}`);
    for (const level of ["off", "medium"]) {
      await runPi(["-e", metadataObserver, "--provider", "discrimen", "--model", "flashnext", "--thinking", level, "--tools", "read", "--no-session", "--print", "Read the fixture."]);
      const model = JSON.parse(await readFile(join(work, "model.json"), "utf8"));
      assert.equal(model.reasoning, true);
      assert.equal(model.contextWindow - 16384, 229376);
      assert.equal(model.maxTokens, 16384);
    }
    const qwenRequests = (await readFile(join(work, "requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)).slice(2);
    assert.equal(qwenRequests.length, 4);
    qwenRequests.forEach((request, index) => {
      assert.equal(request.model, "flashnext");
      assert.equal(request.max_tokens, 16384);
      assert.equal(request.reasoning_effort, index < 2 ? "none" : "medium");
      assert.equal(request.fit_max_tokens, true);
    });

    const settings = JSON.stringify({ httpIdleTimeoutMs: 900000, defaultProvider: "discrimen", defaultModel: "flashnext" });
    const modelOverrides = JSON.stringify({ providers: { discrimen: { modelOverrides: { flashnext: {
      maxTokens: 12000, contextWindow: 200000, samplingParams: { fit_max_tokens: false, temperature: 0.42 },
    } } } } });
    await writeFile(join(agentDir, "settings.json"), settings);
    await writeFile(join(agentDir, "models.json"), modelOverrides);
    await runPi(["-e", metadataObserver, "--thinking", "low", "--tools", "read", "--no-session", "--print", "Read the fixture."]);
    const overridden = JSON.parse(await readFile(join(work, "model.json"), "utf8"));
    assert.equal(overridden.maxTokens, 12000);
    assert.equal(overridden.contextWindow, 200000);
    const allRequests = (await readFile(join(work, "requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    for (const request of allRequests.slice(-2)) {
      assert.equal(request.max_tokens, 12000);
      assert.equal(request.fit_max_tokens, false);
      assert.equal(request.temperature, 0.42);
    }
    assert.deepEqual((await timeoutValues()).slice(-2), ["900", "900"]);
    assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), settings);
    assert.equal(await readFile(join(agentDir, "models.json"), "utf8"), modelOverrides);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

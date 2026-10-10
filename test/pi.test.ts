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
  pi.on("session_start", (_event, ctx) => {
    const original = ctx.ui.setStatus.bind(ctx.ui);
    ctx.ui.setStatus = (key, value) => { appendFileSync(${JSON.stringify(join(work, "statuses.jsonl"))}, JSON.stringify({key, value}) + "\\n"); original(key, value); };
  });
}`);
    const packagePath = await realpath(join(root, "node_modules/@earendil-works/pi-coding-agent"));
    const cli = join(packagePath, "dist/bundle/cli.js");
    const env = { ...process.env, PI_CODING_AGENT_DIR: join(work, "agent"), DISCRIMEN_URL: "https://discrimen.test", DISCRIMEN_API_KEY: "test-client-key", NO_COLOR: "1" };
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
      assert.ok(request.max_tokens > 0);
    }
    const toolResult = requests[1].messages.find((message: any) => message.role === "tool");
    assert.match(JSON.stringify(toolResult), /harmless local test fixture/);
    const statuses = await readFile(join(work, "statuses.jsonl"), "utf8");
    assert.match(statuses, /Discrimen · Auto → Fixture A/);
    assert.match(statuses, /Discrimen · Auto → Fixture B/);
    assert.doesNotMatch(statuses, /test-client-key/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

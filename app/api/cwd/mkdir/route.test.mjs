import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

function post(body) {
  return POST(new Request("http://localhost/api/cwd/mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("creates the folder under the parent and returns its path", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "pi-web-mkdir-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  const response = await post({ parent, name: "new-project" });
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.path, path.join(await realpath(parent), "new-project"));
  assert.ok(existsSync(data.path));
});

test("rejects a folder that already exists", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "pi-web-mkdir-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  assert.equal((await post({ parent, name: "twice" })).status, 200);
  const response = await post({ parent, name: "twice" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already exists/);
});

test("rejects names that escape the parent", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "pi-web-mkdir-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  for (const name of ["..", ".", "a/b", "a\\b", ""]) {
    assert.equal((await post({ parent, name })).status, 400, name);
  }
});

test("reports a missing parent", async () => {
  const response = await post({ parent: "/definitely/not/here/pi-web", name: "child" });
  assert.equal(response.status, 404);
});

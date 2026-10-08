import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { applySessionMove, planSessionMove, sessionDirForCwd } = await jiti.import("./session-move.ts");

const timestamp = "2026-01-01T00:00:00.000Z";
const line = (entry) => JSON.stringify(entry) + "\n";

function fixture(t) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-session-move-"));
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function writeSession(dir, name, header, entries = []) {
  fs.mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  fs.writeFileSync(path, line(header) + entries.map(line).join(""));
  return path;
}

const header = (id, cwd, extra = {}) => ({ type: "session", version: 3, id, cwd, timestamp, ...extra });
const message = (id, content) => ({ type: "message", id, parentId: null, timestamp, message: { role: "user", content } });
const readHeader = (path) => JSON.parse(fs.readFileSync(path, "utf8").split("\n")[0]);

test("sessionDirForCwd encodes the folder exactly like the SDK", (t) => {
  const root = fixture(t);
  const cwd = join(root, "projects", "alpha");
  const expected = join(root, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
  assert.equal(sessionDirForCwd(cwd), expected);
});

test("a session already in the target folder has nothing to move", (t) => {
  const root = fixture(t);
  const cwd = join(root, "projects", "alpha");
  const path = writeSession(sessionDirForCwd(cwd), "a.jsonl", header("root-id", cwd));
  assert.equal(planSessionMove({ filePath: path, targetCwd: cwd, sessions: [] }), null);
});

test("moves the session and its subagents, re-pointing the fork at the new path", (t) => {
  const root = fixture(t);
  const oldCwd = join(root, "projects", "alpha");
  const newCwd = join(root, "projects", "beta");
  const oldDir = sessionDirForCwd(oldCwd);

  const rootPath = writeSession(oldDir, "a_root.jsonl", header("root-id", oldCwd), [message("m1", "hello")]);
  const subPath = writeSession(oldDir, "b_sub.jsonl", header("sub-id", oldCwd, { parentSession: rootPath }), [
    {
      type: "custom", id: "meta", parentId: null, timestamp,
      customType: "pi-web:subagent",
      data: { version: 1, parentSessionId: "root-id", parentSessionPath: rootPath, profile: "worker", description: "d", task: "t" },
    },
    message("m2", "subtask"),
  ]);
  const forkPath = writeSession(oldDir, "c_fork.jsonl", header("fork-id", oldCwd, { parentSession: rootPath }), [message("m3", "fork")]);
  const rootTail = fs.readFileSync(rootPath, "utf8").split("\n").slice(1).join("\n");

  const sessions = [
    { id: "root-id", path: rootPath, cwd: oldCwd },
    { id: "sub-id", path: subPath, cwd: oldCwd, parentSessionId: "root-id", relation: { kind: "subagent", parentSessionId: "root-id", profile: "worker", description: "d", status: "completed" } },
    { id: "fork-id", path: forkPath, cwd: oldCwd, parentSessionId: "root-id", relation: { kind: "fork", originSessionId: "root-id" } },
  ];

  const plan = planSessionMove({ filePath: rootPath, targetCwd: newCwd, sessions });
  assert.ok(plan);
  assert.deepEqual(plan.moves.map((file) => file.id), ["root-id", "sub-id"]);
  assert.deepEqual(plan.references.map((reference) => reference.id), ["fork-id"]);

  applySessionMove(plan);

  const newDir = sessionDirForCwd(newCwd);
  const newRootPath = join(newDir, "a_root.jsonl");
  const newSubPath = join(newDir, "b_sub.jsonl");
  assert.equal(fs.existsSync(rootPath), false);
  assert.equal(fs.existsSync(subPath), false);
  assert.equal(readHeader(newRootPath).cwd, newCwd);
  assert.equal(fs.readFileSync(newRootPath, "utf8").split("\n").slice(1).join("\n"), rootTail);

  const subHeader = readHeader(newSubPath);
  assert.equal(subHeader.cwd, newCwd);
  assert.equal(subHeader.parentSession, newRootPath);
  const subMeta = JSON.parse(fs.readFileSync(newSubPath, "utf8").split("\n")[1]);
  assert.equal(subMeta.data.parentSessionPath, newRootPath);
  assert.equal(subMeta.data.parentSessionId, "root-id");

  // The fork stays where it was; only its link follows the moved parent.
  assert.equal(fs.existsSync(forkPath), true);
  assert.equal(readHeader(forkPath).cwd, oldCwd);
  assert.equal(readHeader(forkPath).parentSession, newRootPath);
});

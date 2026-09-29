import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { BOOKMARK_PREVIEW_CHARS, collectBookmarks, collectSessionBookmarks, truncatePreview } = await jiti.import("./bookmarks.ts");

const session = {
  id: "s1",
  path: "/tmp/one.jsonl",
  cwd: "/root/pi-work",
  name: "pi-web patch (bug 1)",
  firstMessage: "hello",
};

let seq = 0;
function message(role, text) {
  seq += 1;
  return { type: "message", id: `m${seq}`, timestamp: `2026-09-29T0${seq}:00.000Z`, message: { role, content: [{ type: "text", text }] } };
}

function label(targetId, value, timestamp = "2026-09-29T10:00:00.000Z") {
  return { type: "label", id: `l${++seq}`, timestamp, targetId, label: value };
}

test("label 指向消息：取该消息文本作为 превью", () => {
  const user = message("user", "  разбери   баг\nс плагином  ");
  const [bookmark] = collectSessionBookmarks([user, label(user.id, "баг - agegr pi-web")], session);
  assert.equal(bookmark.label, "баг - agegr pi-web");
  assert.equal(bookmark.preview, "разбери баг с плагином");
  assert.equal(bookmark.role, "user");
  assert.equal(bookmark.sessionId, "s1");
  assert.equal(bookmark.sessionName, "pi-web patch (bug 1)");
  assert.equal(bookmark.entryId, user.id);
});

test("предпросмотр обрезается с многоточием", () => {
  const long = "я".repeat(BOOKMARK_PREVIEW_CHARS + 40);
  const user = message("user", long);
  const [bookmark] = collectSessionBookmarks([user, label(user.id, "длинная")], session);
  assert.equal(bookmark.preview.length, BOOKMARK_PREVIEW_CHARS);
  assert.ok(bookmark.preview.endsWith("…"));
  assert.equal(truncatePreview("a\n\n b"), "a b");
});

test("несколько label на одну запись: последний побеждает, пустой удаляет", () => {
  const user = message("user", "текст");
  const entries = [
    user,
    label(user.id, "старое", "2026-09-29T09:00:00.000Z"),
    label(user.id, "новое", "2026-09-29T11:00:00.000Z"),
  ];
  const [bookmark] = collectSessionBookmarks(entries, session);
  assert.equal(bookmark.label, "новое");
  assert.equal(bookmark.preview, "текст");
  assert.equal(bookmark.timestamp, "2026-09-29T11:00:00.000Z");

  // Явная очистка метки удаляет закладку целиком.
  assert.deepEqual(collectSessionBookmarks([...entries, label(user.id, "", "2026-09-29T12:00:00.000Z")], session), []);
  assert.deepEqual(collectSessionBookmarks([...entries, label(user.id, undefined)], session), []);
});

test("label на запись без текста остаётся закладкой без превью", () => {
  const entries = [{ type: "toolCall", id: "t1", timestamp: "2026-09-29T09:00:00.000Z" }, label("t1", "тул")];
  const [bookmark] = collectSessionBookmarks(entries, session);
  assert.equal(bookmark.preview, "");
  assert.equal(bookmark.role, "entry");
  assert.equal(bookmark.label, "тул");
});

test("имя сессии: закладка, иначе первый кадр, иначе путь", () => {
  const named = collectSessionBookmarks(bookmarkFor(), session);
  assert.equal(named[0].sessionName, "pi-web patch (bug 1)");
  const firstFrame = collectSessionBookmarks(bookmarkFor(), { ...session, name: "", firstMessage: "первое сообщение" });
  assert.equal(firstFrame[0].sessionName, "первое сообщение");
  const fallback = collectSessionBookmarks(bookmarkFor(), { ...session, name: "", firstMessage: "", cwd: "" });
  assert.equal(fallback[0].sessionName, "/tmp/one.jsonl");
});

function bookmarkFor() {
  const user = message("user", "x");
  return [user, label(user.id, "a")];
}

function writeSession(dir, id, cwd, name, entries) {
  const file = path.join(dir, `${id}.jsonl`);
  const header = { type: "session", id, cwd, name, created: "2026-09-29T00:00:00.000Z" };
  fs.writeFileSync(file, [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}

test("collectBookmarks: только целевой cwd, новые сверху, битые файлы не роняют индекс", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bookmarks-"));
  const first = message("user", "первый");
  const a = writeSession(dir, "aaa", "/root/pi-work", "A", [first, label(first.id, "старый", "2026-09-28T10:00:00.000Z")]);
  const second = message("user", "второй");
  writeSession(dir, "bbb", "/root/other", "B", [second, label(second.id, "чужой проект", "2026-09-29T10:00:00.000Z")]);
  fs.writeFileSync(path.join(dir, "broken.jsonl"), '{"type":"session"\nnot json at all\n');

  const all = await collectBookmarks([
    { id: "aaa", path: a, cwd: "/root/pi-work", name: "A", firstMessage: "", messageCount: 1, created: "", modified: "", transient: false },
    { id: "bbb", path: path.join(dir, "bbb.jsonl"), cwd: "/root/other", name: "B", firstMessage: "", messageCount: 1, created: "", modified: "", transient: false },
    { id: "ccc", path: path.join(dir, "missing.jsonl"), cwd: "/root/pi-work", name: "C", firstMessage: "", messageCount: 0, created: "", modified: "", transient: false },
  ]);
  assert.deepEqual(all.map((b) => b.label), ["чужой проект", "старый"]);

  const scoped = await collectBookmarks([
    { id: "aaa", path: a, cwd: "/root/pi-work", name: "A", firstMessage: "", messageCount: 1, created: "", modified: "", transient: false },
  ], { cwd: "/root/pi-work" });
  assert.deepEqual(scoped.map((b) => b.label), ["старый"]);

  fs.rmSync(dir, { recursive: true, force: true });
});

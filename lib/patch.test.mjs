import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./patch.ts");
}

test("parses paired changes into split diff rows", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -10,3 +10,3 @@
 const keep = true;
-const value = "old";
+const value = "new";
 done();
`);

  assert.equal(files?.length, 1);
  assert.equal(files?.[0].oldPath, "demo.ts");
  assert.equal(files?.[0].newPath, "demo.ts");
  assert.deepEqual(files?.[0].rows.filter((row) => row.type === "line"), [
    {
      type: "line",
      left: { lineNo: 10, text: "const keep = true;", type: "context" },
      right: { lineNo: 10, text: "const keep = true;", type: "context" },
    },
    {
      type: "line",
      left: { lineNo: 11, text: 'const value = "old";', type: "removed" },
      right: { lineNo: 11, text: 'const value = "new";', type: "added" },
    },
    {
      type: "line",
      left: { lineNo: 12, text: "done();", type: "context" },
      right: { lineNo: 12, text: "done();", type: "context" },
    },
  ]);
});

test("pads one-sided additions and removes timestamp suffixes from file paths", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.ts\t2026-01-01
+++ b/demo.ts\t2026-01-02
@@ -1,1 +1,2 @@
 first
+second
`);

  assert.equal(files?.[0].oldPath, "demo.ts");
  assert.equal(files?.[0].newPath, "demo.ts");
  assert.deepEqual(files?.[0].rows.at(-1), {
    type: "line",
    left: { lineNo: null, text: "", type: "empty" },
    right: { lineNo: 2, text: "second", type: "added" },
  });
});

test("treats in-hunk lines that look like file headers as content", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  // The added line's content starts with "++ " and the removed line's with
  // "-- ", so the raw diff lines are "+++ ..." and "--- ...". They must be
  // parsed as one file's added/removed content, not as new file headers.
  const files = parseUnifiedPatch(`--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,2 @@
-- old bullet
++ new bullet
 tail
`);

  assert.equal(files?.length, 1);
  assert.equal(files?.[0].newPath, "notes.md");
  const lines = files?.[0].rows.filter((row) => row.type === "line");
  assert.deepEqual(lines?.[0], {
    type: "line",
    left: { lineNo: 1, text: "- old bullet", type: "removed" },
    right: { lineNo: 1, text: "+ new bullet", type: "added" },
  });
  assert.deepEqual(lines?.[1], {
    type: "line",
    left: { lineNo: 2, text: "tail", type: "context" },
    right: { lineNo: 2, text: "tail", type: "context" },
  });
});

test("parses multiple files, resuming header detection after each hunk", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/one.ts
+++ b/one.ts
@@ -1 +1 @@
-a
+b
--- a/two.ts
+++ b/two.ts
@@ -1 +1 @@
-c
+d
`);

  assert.equal(files?.length, 2);
  assert.equal(files?.[0].newPath, "one.ts");
  assert.equal(files?.[1].newPath, "two.ts");
});

test("drops git's a/ and b/ prefixes only at the start of their own side", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/b/a/x.ts
+++ b/a/b/x.ts
@@ -1 +1 @@
-a
+b
--- src/a/y.ts
+++ src/b/y.ts
@@ -1 +1 @@
-c
+d
`);

  assert.equal(files?.[0].oldPath, "b/a/x.ts");
  assert.equal(files?.[0].newPath, "a/b/x.ts");
  assert.equal(files?.[1].oldPath, "src/a/y.ts");
  assert.equal(files?.[1].newPath, "src/b/y.ts");
});

test("leaves out a /dev/null side instead of naming it as a path", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- /dev/null
+++ b/added.ts
@@ -0,0 +1 @@
+new
--- a/gone.ts\t2026-01-01
+++ /dev/null\t2026-01-02
@@ -1 +0,0 @@
-old
`);

  assert.equal(files?.[0].oldPath, undefined);
  assert.equal(files?.[0].newPath, "added.ts");
  assert.equal(files?.[1].oldPath, "gone.ts");
  assert.equal(files?.[1].newPath, undefined);
});

test("returns null for text without diff lines", async () => {
  const { parseUnifiedPatch } = await loadSubject();

  assert.equal(parseUnifiedPatch("not a patch"), null);
});

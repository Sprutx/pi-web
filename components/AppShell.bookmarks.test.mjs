import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8");
const shell = read("./AppShell.tsx");
const window = read("./ChatWindow.tsx");

test("顶部工具栏的书签按钮打开面板而非发送命令", () => {
  assert.match(shell, /onClick=\{\(\) => toggleTopPanel\("bookmarks", mobile\)\}/);
  assert.match(shell, /aria-pressed=\{activeTopPanel === "bookmarks"\}/);
  assert.match(shell, /translate\("bookmarks\.label"\)/);
  assert.match(shell, /translate\("bookmarks\.title"\)/);
  // The extension command path is gone: the panel is the web entry point.
  assert.doesNotMatch(shell, /BOOKMARKS_COMMAND/);
});

test("面板收到会话目录与当前会话，用于跳转", () => {
  assert.match(shell, /<BookmarksPanel[\s\S]*?sessions=\{sessionsWithSelection\}/);
  assert.match(shell, /currentSessionId=\{selectedSession\?\.id \?\? null\}/);
  assert.match(shell, /onSelect=\{handleBookmarkSelect\}/);
});

test("书签跳转经 pendingTreeTarget 交给 ChatWindow", () => {
  // Same session: no re-select, just move the tree leaf.
  assert.match(shell, /if \(selectedSession\?\.id === bookmark\.sessionId\) \{\s*setPendingTreeTarget\(target\);\s*return;/);
  // Other session: select it first, carrying the entry for scroll targeting.
  assert.match(shell, /handleSelectSession\(session, false, bookmark\.entryId\)/);
  assert.match(shell, /initialTreeTarget=\{pendingTreeTarget\?\.sessionId === selectedSession\?\.id \? pendingTreeTarget : null\}/);
  assert.match(shell, /onInitialTreeTargetConsumed=\{\(\) => setPendingTreeTarget\(null\)\}/);
});

test("ChatWindow 只为目标会话执行一次 navigate_tree", () => {
  assert.match(window, /if \(initialTreeTargetSentRef\.current === initialTreeTarget\.token\) return;/);
  assert.match(window, /if \(session\?\.id !== initialTreeTarget\.sessionId\) return;/);
  assert.match(window, /void handleNavigate\(initialTreeTarget\.entryId\);/);
  // Wait for the same quiet point as initialPrompt, so a session switch that
  // is still loading cannot navigate the wrong transcript.
  assert.match(window, /if \(loading \|\| error \|\| !initialTreeTarget\) return;/);
});

test("书签按钮在移动端溢出菜单中可用", () => {
  assert.match(shell, /data-mobile-toolbar-action=\{mobile \? "bookmarks" : undefined\}/);
});

test("书签按钮的翻译键在全部语言包中存在", () => {
  const keys = [
    "bookmarks.label",
    "bookmarks.title",
    "bookmarks.count",
    "bookmarks.loading",
    "bookmarks.empty",
    "bookmarks.emptyHint",
    "bookmarks.scope",
    "bookmarks.scopeProject",
    "bookmarks.scopeAll",
    "bookmarks.currentSession",
    "bookmarks.notOpenable",
    "bookmarks.openTitle",
  ];
  for (const locale of ["en.ts", "zh-CN.ts", "zh-TW.ts"]) {
    const messages = read(`../lib/i18n/messages/${locale}`);
    for (const key of keys) {
      assert.match(messages, new RegExp(`"${key.replace(/\./g, "\\.")}": "[^"]+"`), `${locale} needs ${key}`);
    }
  }
});

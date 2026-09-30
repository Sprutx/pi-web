import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const dialogSource = source.slice(source.indexOf("function ExtensionDialog"));
const customSource = source.slice(source.indexOf("function ExtensionCustomPanel"));

test("confines extension overlays to the content region above the composer", () => {
  assert.doesNotMatch(source, /function ExtensionRequestSheet/);
  assert.match(
    source,
    /className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"[\s\S]*?<ExtensionDialog[\s\S]*?<ExtensionCustomPanel[\s\S]*?className="relative shrink-0"[\s\S]*?{chatInputElement}/,
  );
  assert.match(dialogSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(dialogSource, /pointerEvents: "none"/);
  assert.match(dialogSource, /pointerEvents: "auto"/);
  assert.match(customSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(customSource, /pointerEvents: "none"/);
  assert.doesNotMatch(source, /z-\[100\]|zIndex: 100/);
  assert.match(customSource, /maxHeight: "min\(760px, 100%\)"/);
});

test("adds collapse without replacing cancel", () => {
  assert.match(dialogSource, /setCollapsed\(true\)/);
  assert.match(dialogSource, /chat\.extensionCollapse/);
  assert.match(dialogSource, /chat\.cancel/);
  assert.doesNotMatch(dialogSource, /chat\.extensionSkip/);
});

test("renders extension confirmation and options as markdown", () => {
  assert.match(source, /import \{ MarkdownBody \} from "\.\/MarkdownBody"/);
  assert.match(dialogSource, /<MarkdownBody>\{request\.message\}<\/MarkdownBody>/);
  assert.match(dialogSource, /role="button"[\s\S]*?data-extension-option[\s\S]*?<div inert>[\s\S]*?<MarkdownBody>\{option\}<\/MarkdownBody>/);
  assert.match(dialogSource, /ref=\{index === 0 \? focusFirstOption : undefined\}/);
});

test("preserves title newlines like pi's TUI and keeps long titles from hiding the body", () => {
  const header = dialogSource.slice(dialogSource.indexOf('role="dialog"'), dialogSource.indexOf("{request.method === \"confirm\""));
  assert.match(header, /whiteSpace: "pre-wrap", overflowWrap: "anywhere" \}\}>\{request\.title\}/);
  // The header keeps a ceiling so a long title scrolls instead of eating the
  // whole window; the options live outside that scroller.
  assert.match(header, /maxHeight: "38%", overflowY: "auto" \}\}>[\s\S]*?\{request\.title\}/);
});

test("pins the answer options below the scrolling text", () => {
  const scroller = dialogSource.slice(
    dialogSource.indexOf('{request.method !== "select"'),
    dialogSource.indexOf('{request.method === "select" && request.options.length > 0'),
  );
  assert.match(scroller, /flex: "1 1 auto", minHeight: 0, overflowY: "auto"/);
  // The options block is a sibling of that scroller, not a child of it.
  assert.doesNotMatch(scroller, /data-extension-option/);

  const options = dialogSource.slice(
    dialogSource.indexOf('{request.method === "select" && request.options.length > 0'),
  );
  assert.match(options, /flexShrink: 0[\s\S]*?maxHeight: "45%"[\s\S]*?overflowY: "auto"/);
  assert.match(options, /data-extension-option/);
  // The action buttons stay last and never scroll out of reach.
  assert.match(dialogSource, /request\.method === "select"[\s\S]*?justifyContent: "flex-end"[\s\S]*?chat\.cancel/);
});

test("resets collapse state when a new extension request arrives", () => {
  assert.match(source, /<ExtensionDialog key=\{extensionDialog.id\}/);
  assert.match(source, /<ExtensionCustomPanel key=\{extensionCustomUi.id\}/);
  assert.match(customSource, /if \(!collapsed\) inputRef.current\?\.focus\(\);\s*}, \[collapsed\]\)/);
});

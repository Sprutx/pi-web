import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const PATCH = `--- a/components/ChatInput.tsx
+++ b/components/ChatInput.tsx
@@ -10,7 +10,7 @@
 function useDraft() {
-  const [draft, setDraft] = useState("");
+  const [draft, setDraft] = useState("x");
   return { draft, setDraft };
 }`;

function toHtml(markdown) {
  // The split view reads labels through i18n, so it needs the provider around it.
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(MarkdownBody, null, markdown)),
  );
}

function splitGrid(html) {
  // The side-by-side layout is a two-column grid; both sides come from SplitFilesView.
  return /grid-template-columns:minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(html);
}

test("a diff fence renders as the two-column view used by tool results", () => {
  const html = toHtml("```diff\n" + PATCH + "\n```");

  assert.ok(splitGrid(html), "ожидалась сетка из двух колонок");
  // Added line: green background and a + marker; removed: red and a -.
  assert.ok(html.includes("rgba(34,197,94,0.12)"), "нет зелёной подложки добавленной строки");
  assert.ok(html.includes("rgba(248,113,113,0.13)"), "нет красной подложки удалённой строки");
  assert.ok(html.includes(">10<") || html.includes(">11<"), "нет номеров строк");
  // react-markdown escapes the markup inside the cell, so match the escaped form.
  assert.ok(html.includes("useState(&quot;x&quot;)"), "нет текста добавленной строки");
});

test("a patch fence renders the same way", () => {
  const html = toHtml("```patch\n" + PATCH + "\n```");

  assert.ok(splitGrid(html), "ожидалась сетка из двух колонок");
});

test("prose tagged as diff stays a plain code block", () => {
  const html = toHtml("```diff\nпросто текст про git\n```");

  assert.ok(!splitGrid(html), "пояс в diff не должен становиться разворотом");
  assert.ok(html.includes("просто текст про git"), "текст должен сохраниться");
});

test("an ordinary code fence is untouched", () => {
  const html = toHtml("```ts\nconst a = 1;\n```");

  assert.ok(!splitGrid(html), "обычный fence не должен превращаться в разворот");
  // CodeBlock highlights per token, so check the frame and the language label.
  assert.ok(html.includes("markdown-code-block"), "обычный fence должен остаться блоком кода");
  assert.ok(html.includes("markdown-code-lang"), "обычный fence должен сохранить заголовок с языком");
});

test("inline code is never treated as a patch", () => {
  const html = toHtml("строка `--- a` и `+++ b` в тексте");

  assert.ok(!splitGrid(html), "инлайн-код не должен становиться разворотом");
});
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  DEFAULT_EXPANDED_WIDGET_LINES,
  ExtensionWidgets,
  findWidgetActionStart,
  formatExtensionWidgetContent,
  getNextExpandedWidgetKey,
  getUpdatedExtensionWidgetKeys,
  snapshotExtensionWidgetContents,
} = await jiti.import("./ExtensionWidgets.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderWidgets(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionWidgets, props),
    ),
  );
}

test("renders short extension widgets without a truncation marker", () => {
  const html = renderWidgets({
    widgets: [{ key: "short", lines: ["first", "second"], placement: "aboveEditor" }],
  });

  assert.match(html, /first\nsecond/);
  assert.doesNotMatch(html, /widget truncated/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-direction="up"/);
  assert.doesNotMatch(html, /[\u2191\u2193]/);
});

test("collapses long widgets by default", () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `line-${index + 1}`,
  );
  const html = renderWidgets({
    widgets: [{ key: "long", lines, placement: "belowEditor" }],
  });

  assert.ok(lines.length > DEFAULT_EXPANDED_WIDGET_LINES);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-direction="down"/);
  assert.doesNotMatch(html, /<pre/);
  assert.doesNotMatch(html, /line-1/);
  assert.doesNotMatch(html, /line-10/);
  assert.doesNotMatch(html, /line-12/);
});

test("keeps all widget lines available for the scrollable expanded panel", () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `line-${index + 1}`,
  );
  const content = formatExtensionWidgetContent(lines);

  assert.match(content, /line-10/);
  assert.match(content, /line-12/);
  assert.doesNotMatch(content, /widget truncated/);
});

test("keeps compact widgets expanded by default", () => {
  const lines = Array.from(
    { length: DEFAULT_EXPANDED_WIDGET_LINES },
    (_, index) => `line-${index + 1}`,
  );
  const html = renderWidgets({
    widgets: [{ key: "compact", lines, placement: "aboveEditor" }],
  });

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /<pre/);
});

test("expands at most one compact widget", () => {
  const html = renderWidgets({
    widgets: [
      { key: "first", lines: ["one", "two"], placement: "aboveEditor" },
      { key: "second", lines: ["three", "four"], placement: "belowEditor" },
    ],
  });

  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/<section/g) ?? []).length, 1);
  assert.match(html, /aria-labelledby="[^"]*trigger-0"/);
  assert.doesNotMatch(html, /aria-labelledby="[^"]*trigger-1"/);
});

test("switching widgets closes the previously expanded widget", () => {
  assert.equal(getNextExpandedWidgetKey(null, "first"), "first");
  assert.equal(getNextExpandedWidgetKey("first", "second"), "second");
  assert.equal(getNextExpandedWidgetKey("second", "second"), null);
});

test("detects only existing widgets whose line content changed", () => {
  const previous = snapshotExtensionWidgetContents([
    { key: "changed", lines: ["one"], placement: "aboveEditor" },
    { key: "same", lines: ["ready"], placement: "belowEditor" },
    { key: "removed", lines: ["gone"], placement: "belowEditor" },
  ]);
  const next = snapshotExtensionWidgetContents([
    { key: "same", lines: ["ready"], placement: "aboveEditor" },
    { key: "changed", lines: ["one", "two"], placement: "belowEditor" },
    { key: "added", lines: ["new"], placement: "aboveEditor" },
  ]);

  assert.deepEqual(getUpdatedExtensionWidgetKeys(previous, next), ["changed"]);
  assert.deepEqual(getUpdatedExtensionWidgetKeys(null, next), []);
});

test("compares widget lines without delimiter collisions", () => {
  const previous = new Map([["status", ["one", "two"]]]);
  const next = new Map([["status", ["one\ntwo"]]]);

  assert.deepEqual(getUpdatedExtensionWidgetKeys(previous, next), ["status"]);
});

test("keeps one-line widgets compact but expandable", () => {
  const html = renderWidgets({
    widgets: [{ key: "single-line-widget", lines: ["ready"], placement: "belowEditor" }],
  });

  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /<svg[^>]*extension-widget-placement-icon/);
  assert.match(html, /data-direction="down"/);
  assert.doesNotMatch(html, /[\u2191\u2193]/);
  assert.match(html, /Below editor widget/);
  assert.match(html, /<button[^>]*class="extension-widget-trigger/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /title="single-line-widget - Below editor widget - Expand"/);
  assert.match(html, /extension-widget-key/);
  assert.match(html, /extension-widget-update-pulse/);
  assert.doesNotMatch(html, /extension-widget-preview/);
  assert.doesNotMatch(html, /extension-widget-line-count/);
  assert.doesNotMatch(html, />ready</);
  assert.doesNotMatch(html, /<pre/);
});

test("keeps empty widgets non-interactive", () => {
  const html = renderWidgets({
    widgets: [{ key: "empty-widget", lines: [], placement: "aboveEditor" }],
  });

  assert.match(html, /<div class="extension-widget-trigger/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /aria-expanded/);
  assert.match(html, /title="empty-widget - Above editor widget"/);
});

// The shape pi-permission-system renders: title, the ask, a blank line, the
// action rows, another blank line, then a one-line hint.
const PERMISSION_PROMPT = [
  "Permission required",
  "",
  "pi needs to run a command",
  "  systemctl restart pi-web",
  "",
  "▶ (y) Allow once",
  "  (a) Allow for this session",
  "  (n) Deny",
  "",
  "enter confirm · esc deny",
];

test("action rows start at the first option and run to the end of the widget", () => {
  assert.equal(findWidgetActionStart(PERMISSION_PROMPT), 5);
  assert.deepEqual(PERMISSION_PROMPT.slice(5), [
    "▶ (y) Allow once",
    "  (a) Allow for this session",
    "  (n) Deny",
    "",
    "enter confirm · esc deny",
  ]);
});

test("a widget without action rows has no pinned footer", () => {
  assert.equal(findWidgetActionStart(["Todos", "├─ done one", "└─ pending two"]), -1);
  assert.equal(findWidgetActionStart([]), -1);
});

test("a parenthesised aside mid-description does not pin the rest", () => {
  const lines = [
    "Permission required",
    "  runs curl (see docs) against the api",
    "more description",
    "",
    "enter confirm · esc deny",
  ];
  assert.equal(findWidgetActionStart(lines), -1);
});

test("the highlighted marker is optional", () => {
  const lines = [
    "Question",
    "",
    "▶ (a) Approve session",
    "  (b) Approve both sessions",
    "",
    "↑/↓ move · enter confirm · esc back",
  ];
  assert.equal(findWidgetActionStart(lines), 2);
});

test("a single trailing line rides along with the actions as the hint", () => {
  const lines = ["Question", "  (y) Yes", "  (n) No", "", "why this is being asked"];
  assert.equal(findWidgetActionStart(lines), 1);
});

test("more than one closing line is not an action footer", () => {
  // Two or more trailing lines cannot be told from a hint, so nothing is
  // pinned: hiding a second block of real content would be worse than scrolling.
  const lines = ["Question", "  (y) Yes", "", "first note", "second note"];
  assert.equal(findWidgetActionStart(lines), -1);
});

test("renders the pinned actions in their own block below the scrolling body", () => {
  // Widgets longer than DEFAULT_EXPANDED_WIDGET_LINES start collapsed, so the
  // panel is rendered from a short prompt that is expanded on first paint.
  const html = renderWidgets({
    widgets: [{
      key: "perm",
      lines: ["Question", "  (y) Allow once", "  (n) Deny"],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /extension-widget-body/);
  assert.match(html, /extension-widget-actions/);
  // The scrolling body holds only the lines above the first action row.
  const body = html.match(/extension-widget-body"><pre[^]*?<\/pre>/)?.[0] ?? "";
  assert.notEqual(body, "");
  assert.doesNotMatch(body, /Allow once/);
  assert.match(body, /Question/);
  assert.match(html, /extension-widget-actions"><span>  \(y\) Allow once/);
});

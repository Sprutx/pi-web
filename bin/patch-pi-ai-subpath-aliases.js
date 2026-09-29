// Pi Web imports @earendil-works/pi-coding-agent as a normal package, so the
// extension loader runs from dist/ instead of the bundled CLI. On that code
// path getAliases() maps "@earendil-works/pi-ai" to .../pi-ai/dist/compat.js,
// and jiti applies that alias by *prefix* match. An extension importing a pi-ai
// subpath (for example pi-opencode-direct's
// "@earendil-works/pi-ai/api/openai-completions.lazy") is therefore rewritten to
// .../pi-ai/dist/compat.js/api/openai-completions.lazy, which does not exist.
// The extension silently fails to load, so its provider never registers and its
// models never reach /api/models.
//
// The bundled CLI is unaffected: it uses embedded virtual modules instead of
// these aliases, which is why the same extension loads there.
//
// Fix: add explicit aliases for every pi-ai dist/api subpath so the exact
// subpath wins over the prefix alias. Idempotent, and a no-op whenever the
// installed pi-coding-agent does not need it.
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const MARKER = "pi-web:pi-ai-subpath-aliases";

// Each namespace is a full copy of the alias table in getAliases(), so the
// legacy package name needs the same subpath entries.
const NAMESPACES = ["@earendil-works/pi-ai", "@mariozechner/pi-ai"];

// The anchor is the root alias for each namespace; subpath entries go right
// after it so the longer keys sit next to the key they would otherwise be
// swallowed by.
function anchorPattern(namespace) {
  return new RegExp(`^(\\s*)"${namespace.replace("/", "\\/")}": piAiCompatEntry,$`, "m");
}

function loaderPath(packageRoot) {
  return join(packageRoot, "dist", "core", "extensions", "loader.js");
}

function apiModuleNames(piAiRoot) {
  const apiDir = join(piAiRoot, "dist", "api");
  if (!existsSync(apiDir)) return [];
  return readdirSync(apiDir)
    // dist/api holds "<name>.js" next to "<name>.d.ts" and "<name>.js.map";
    // only the runtime entry points are importable module names.
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => entry.slice(0, -".js".length))
    .sort();
}

function patch(packageRoot) {
  const loader = loaderPath(packageRoot);
  if (!existsSync(loader)) {
    return { status: "skipped", reason: `no dist extension loader at ${loader}` };
  }

  const original = readFileSync(loader, "utf8");
  if (original.includes(MARKER)) {
    return { status: "skipped", reason: "already patched" };
  }

  // pi-ai is a sibling of pi-coding-agent in both a workspace and a plain
  // node_modules layout. package.json cannot be require.resolve()d because
  // pi-ai does not export it, so walk the directory instead.
  const piAiRoot = join(packageRoot, "..", "pi-ai");
  const modules = apiModuleNames(piAiRoot);
  if (modules.length === 0) {
    return { status: "skipped", reason: `no pi-ai dist/api modules next to ${packageRoot}` };
  }

  let patched = original;
  let inserted = 0;
  for (const namespace of NAMESPACES) {
    const match = anchorPattern(namespace).exec(patched);
    if (!match) continue;
    const [, indent] = match;
    // Derive the target from piAiCompatEntry, which getAliases() has already
    // resolved in this scope. resolveWorkspaceOrImport() is not usable here:
    // its import.meta.resolve() fallback throws for a namespace that is not
    // installed, which would abort the whole alias table and fail every
    // extension load.
    const entries = modules
      .map((name) => {
        const specifier = `${namespace}/api/${name}`;
        return `${indent}"${specifier}": path.join(path.dirname(piAiCompatEntry), "api", "${name}.js"),`;
      })
      .join("\n");
    const anchor = match[0];
    patched = patched.replace(anchor, `${anchor}\n        // ${MARKER}\n${entries}`);
    inserted += modules.length;
  }

  if (inserted === 0) {
    return { status: "skipped", reason: "getAliases() has no pi-ai root alias to extend" };
  }
  writeFileSync(loader, patched);
  return { status: "patched", inserted };
}

const DEPENDENCY = join("@earendil-works", "pi-coding-agent");

function resolvePackageRoot() {
  // bin/ lives inside the published package, so the dependency sits in this
  // package's own node_modules or in a hoisted one above it. Walk up looking
  // for the package directory rather than require.resolve()ing its entry
  // point: a missing or broken "main" would otherwise look like "not
  // installed" and silently skip the fix.
  let dir = __dirname;
  for (;;) {
    const candidate = join(dir, "node_modules", DEPENDENCY);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function main() {
  // An explicit target keeps the patch testable without a full install.
  const targetIndex = process.argv.indexOf("--target");
  const packageRoot = targetIndex >= 0 ? process.argv[targetIndex + 1] : resolvePackageRoot();
  if (!packageRoot) {
    console.log("patch-pi-ai-subpath-aliases: pi-coding-agent not installed, nothing to do");
    return;
  }
  const result = patch(packageRoot);
  if (result.status === "patched") {
    console.log(`patch-pi-ai-subpath-aliases: added ${result.inserted} pi-ai subpath aliases to ${packageRoot}`);
  } else {
    console.log(`patch-pi-ai-subpath-aliases: ${result.reason}`);
  }
}

try {
  main();
} catch (error) {
  // Never fail an install over an optional fix: a missing patch only costs the
  // extension-registered providers, the UI still works.
  console.warn(`patch-pi-ai-subpath-aliases: skipped (${error instanceof Error ? error.message : String(error)})`);
}

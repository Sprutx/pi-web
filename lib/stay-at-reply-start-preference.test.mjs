import assert from "node:assert/strict";
import test from "node:test";

import {
  isStayAtReplyStartEnabled,
  setStayAtReplyStartEnabled,
} from "./stay-at-reply-start-preference.ts";

function installWindow() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
  return globalThis.window;
}

test("is on when no preference is stored", () => {
  installWindow();
  assert.equal(isStayAtReplyStartEnabled(), true);
});

test("persists an off choice and an on choice", () => {
  installWindow();
  setStayAtReplyStartEnabled(false);
  assert.equal(isStayAtReplyStartEnabled(), false);
  setStayAtReplyStartEnabled(true);
  assert.equal(isStayAtReplyStartEnabled(), true);
});

test("is on when window.localStorage throws", () => {
  const fakeWindow = installWindow();
  Object.defineProperty(fakeWindow, "localStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  assert.equal(isStayAtReplyStartEnabled(), true);
  assert.doesNotThrow(() => setStayAtReplyStartEnabled(false));
});

test("is on when window is unavailable (SSR)", () => {
  const original = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(isStayAtReplyStartEnabled(), true);
  } finally {
    if (original !== undefined) globalThis.window = original;
  }
});

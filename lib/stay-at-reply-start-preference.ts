const STORAGE_KEY = "pi-stay-at-reply-start";

// On unless the user switched it off: a missing or unreadable value means on.
export function isStayAtReplyStartEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setStayAtReplyStartEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Nothing was saved, so the choice stays as it was.
  }
}

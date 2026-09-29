/**
 * Cross-session bookmark index.
 *
 * A bookmark in pi is a `label` entry pointing at another entry
 * (see docs/session-format.md in pi-coding-agent). Labels live inside one
 * session file and the transcript UI only ever shows the current session, so
 * this module walks the session list and rebuilds one global index of them.
 */

import { getSessionEntries } from "./session-reader";
import type { SessionEntry, SessionInfo } from "./types";

export interface SessionBookmark {
  sessionId: string;
  sessionPath: string;
  sessionName: string;
  cwd: string;
  /** Entry the label points at. */
  entryId: string;
  label: string;
  /** Timestamp of the most recent label entry for this target. */
  timestamp: string;
  /** "user" / "assistant" for messages, "entry" otherwise. */
  role: string;
  preview: string;
}

export const BOOKMARK_PREVIEW_CHARS = 110;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: string }) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join(" ");
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncatePreview(value: string, max = BOOKMARK_PREVIEW_CHARS): string {
  const text = collapseWhitespace(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function sessionName(session: Pick<SessionInfo, "name" | "firstMessage" | "cwd" | "path">): string {
  if (session.name) return session.name;
  const first = collapseWhitespace(session.firstMessage ?? "");
  if (first) return truncatePreview(first, 40);
  return session.cwd || session.path;
}

/**
 * Live bookmarks of one session.
 *
 * Sessions are append-only JSONL, so a torn line is possible and the caller
 * already drops unparsable ones. A later label for the same target supersedes
 * an earlier one, and a cleared label (undefined/empty) removes the bookmark —
 * that is how pi's own session manager resolves labels.
 */
export function collectSessionBookmarks(
  entries: readonly SessionEntry[],
  session: Pick<SessionInfo, "id" | "path" | "cwd" | "name" | "firstMessage">,
): SessionBookmark[] {
  const previews = new Map<string, { role: string; text: string }>();
  const labels = new Map<string, { label: string; timestamp: string }>();

  for (const entry of entries) {
    if (entry.type === "message") {
      const text = messageText((entry as { message?: { role?: string; content?: unknown } }).message?.content);
      if (text) previews.set(entry.id, { role: String((entry as { message?: { role?: string } }).message?.role ?? "?"), text });
    }
    else if (entry.type === "label") {
      const targetId = (entry as { targetId?: string }).targetId;
      if (typeof targetId !== "string") continue;
      const label = typeof (entry as { label?: string }).label === "string"
        ? (entry as { label: string }).label.trim()
        : "";
      if (label) labels.set(targetId, { label, timestamp: entry.timestamp });
      else labels.delete(targetId);
    }
  }

  const name = sessionName(session);
  const bookmarks: SessionBookmark[] = [];
  for (const [entryId, { label, timestamp }] of labels) {
    const target = previews.get(entryId);
    bookmarks.push({
      sessionId: session.id,
      sessionPath: session.path,
      sessionName: name,
      cwd: session.cwd,
      entryId,
      label,
      timestamp,
      role: target?.role ?? "entry",
      preview: target ? truncatePreview(target.text) : "",
    });
  }
  return bookmarks;
}

/** Newest bookmark first. */
function byNewest(a: SessionBookmark, b: SessionBookmark): number {
  return b.timestamp.localeCompare(a.timestamp) || b.sessionPath.localeCompare(a.sessionPath);
}

export async function collectBookmarks(
  sessions: readonly SessionInfo[],
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<SessionBookmark[]> {
  const scope = options.cwd?.trim();
  const bookmarks: SessionBookmark[] = [];

  for (const session of sessions) {
    options.signal?.throwIfAborted();
    if (scope && session.cwd !== scope) continue;
    try {
      bookmarks.push(...collectSessionBookmarks(getSessionEntries(session.path), session));
    }
    catch (error) {
      // A truncated or concurrently written file must not fail the whole index.
      if ((error as { code?: string })?.code !== "ENOENT") {
        console.error(`[bookmarks] failed to read ${session.path}:`, error);
      }
    }
  }

  return bookmarks.sort(byNewest);
}

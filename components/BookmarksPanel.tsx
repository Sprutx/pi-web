"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionBookmark } from "@/lib/bookmarks";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  /** Cwd of the session the user is looking at; scopes the "project" filter. */
  currentCwd: string | null;
  currentSessionId: string | null;
  /** Sessions the user can switch to, used to resolve a bookmark to a session. */
  sessions: readonly SessionInfo[];
  translate: Translate;
  onSelect: (bookmark: SessionBookmark) => void;
}

type Scope = "project" | "all";

function formatWhen(timestamp: string, locale: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp.replace("T", " ").slice(0, 16);
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Collapse a long home path to ~/… so the session line stays narrow. */
function shortPath(value: string): string {
  return value.replace(/^\/(?:home|root)(?=\/|$)/, "~") || value;
}

export function BookmarksPanel({ currentCwd, currentSessionId, sessions, translate, onSelect }: Props) {
  const [scope, setScope] = useState<Scope>(currentCwd ? "project" : "all");
  const [bookmarks, setBookmarks] = useState<SessionBookmark[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (currentCwd) setScope((current) => (current === "project" ? "project" : current));
  }, [currentCwd]);

  useEffect(() => {
    const controller = new AbortController();
    // Project scope sends the cwd so the server can narrow the scan; "all" omits it.
    const query = scope === "project" && currentCwd ? `?cwd=${encodeURIComponent(currentCwd)}` : "";
    setBookmarks(null);
    setError(null);
    fetch(`/api/bookmarks${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { bookmarks?: SessionBookmark[]; error?: string } | null;
        if (!response.ok || !data) throw new Error(data?.error || `HTTP ${response.status}`);
        setBookmarks(data.bookmarks ?? []);
        setActiveIndex(0);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setBookmarks([]);
      });
    return () => controller.abort();
  }, [currentCwd, scope]);

  const open = useCallback((bookmark: SessionBookmark) => {
    onSelect(bookmark);
  }, [onSelect]);

  const known = useMemo(() => new Set(sessions.map((session) => session.id)), [sessions]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!bookmarks?.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + delta + bookmarks.length) % bookmarks.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = bookmarks[activeIndex];
      if (target) open(target);
    }
  }, [activeIndex, bookmarks, open]);

  return (
    <section className="bookmarks-panel" aria-label={translate("bookmarks.label")} onKeyDown={onKeyDown}>
      <header className="bookmarks-header">
        <span className="bookmarks-count">
          {bookmarks === null
            ? translate("bookmarks.loading")
            : translate("bookmarks.count", { count: bookmarks.length })}
        </span>
        <span className="bookmarks-scopes" role="group" aria-label={translate("bookmarks.scope")}>
          <button
            type="button"
            className={scope === "project" ? "bookmarks-scope bookmarks-scope-active" : "bookmarks-scope"}
            disabled={!currentCwd}
            onClick={() => setScope("project")}
            aria-pressed={scope === "project"}
          >
            {translate("bookmarks.scopeProject")}
          </button>
          <button
            type="button"
            className={scope === "all" ? "bookmarks-scope bookmarks-scope-active" : "bookmarks-scope"}
            onClick={() => setScope("all")}
            aria-pressed={scope === "all"}
          >
            {translate("bookmarks.scopeAll")}
          </button>
        </span>
      </header>

      <div className="bookmarks-scroll">
        {error ? (
          <p className="bookmarks-empty bookmarks-error">{error}</p>
        ) : bookmarks === null ? (
          <p className="bookmarks-empty">{translate("bookmarks.loading")}</p>
        ) : bookmarks.length === 0 ? (
          <p className="bookmarks-empty">
            {translate("bookmarks.empty")}
            <span className="bookmarks-hint">{translate("bookmarks.emptyHint")}</span>
          </p>
        ) : (
          <ul className="bookmarks-list">
            {bookmarks.map((bookmark, index) => (
              <li key={`${bookmark.sessionId}:${bookmark.entryId}`}>
                <button
                  type="button"
                  className={index === activeIndex ? "bookmarks-row bookmarks-row-active" : "bookmarks-row"}
                  onClick={() => open(bookmark)}
                  onMouseEnter={() => setActiveIndex(index)}
                  title={translate("bookmarks.openTitle", { label: bookmark.label })}
                >
                  <span className="bookmarks-row-top">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                    <time className="bookmarks-when" dateTime={bookmark.timestamp}>
                      {formatWhen(bookmark.timestamp, "ru-RU")}
                    </time>
                    <span className="bookmarks-session" title={bookmark.sessionPath}>
                      {bookmark.sessionId === currentSessionId
                        ? translate("bookmarks.currentSession")
                        : shortPath(bookmark.cwd)}
                    </span>
                    {!known.has(bookmark.sessionId) && (
                      <span className="bookmarks-flag">{translate("bookmarks.notOpenable")}</span>
                    )}
                  </span>
                  <span className="bookmarks-label">{bookmark.label}</span>
                  {bookmark.preview && <span className="bookmarks-preview">{bookmark.preview}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <style>{`
        .bookmarks-panel {
          display: flex;
          height: min(600px, 75dvh);
          min-height: 220px;
          flex-direction: column;
          background: var(--bg-panel);
          border-bottom: 1px solid var(--border);
        }
        .bookmarks-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
        }
        .bookmarks-count {
          color: var(--text-muted);
          font-size: 11px;
        }
        .bookmarks-scopes {
          display: inline-flex;
          border: 1px solid var(--border);
          border-radius: 6px;
          overflow: hidden;
        }
        .bookmarks-scope {
          padding: 3px 8px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
        }
        .bookmarks-scope:disabled {
          color: var(--text-dim);
          cursor: not-allowed;
        }
        .bookmarks-scope-active {
          background: var(--bg-selected);
          color: var(--text);
        }
        .bookmarks-scroll {
          min-height: 0;
          flex: 1;
          overflow: auto;
          padding: 6px;
        }
        .bookmarks-list {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .bookmarks-row {
          display: flex;
          width: 100%;
          flex-direction: column;
          gap: 2px;
          padding: 7px 9px;
          background: none;
          border: none;
          border-radius: 6px;
          color: var(--text);
          cursor: pointer;
          text-align: left;
        }
        .bookmarks-row + li .bookmarks-row {
          margin-top: 2px;
        }
        .bookmarks-row:hover,
        .bookmarks-row-active {
          background: var(--bg-hover);
        }
        .bookmarks-row-top {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-dim);
          font-size: 10px;
        }
        .bookmarks-when {
          font-variant-numeric: tabular-nums;
        }
        .bookmarks-session {
          overflow: hidden;
          color: var(--text-muted);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bookmarks-flag {
          margin-left: auto;
          color: #dc2626;
        }
        .bookmarks-label {
          font-size: 12px;
          font-weight: 500;
          overflow-wrap: anywhere;
        }
        .bookmarks-preview {
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.45;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bookmarks-empty {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 0;
          padding: 10px 4px;
          color: var(--text-muted);
          font-size: 12px;
          font-style: italic;
        }
        .bookmarks-error {
          color: #dc2626;
        }
        .bookmarks-hint {
          color: var(--text-dim);
          font-size: 11px;
          font-style: normal;
        }
      `}</style>
    </section>
  );
}

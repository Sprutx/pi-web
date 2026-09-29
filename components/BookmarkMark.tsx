"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * Fork: the label of a bookmarked message, shown above it in the transcript.
 * The icon is the one on the top-bar Bookmarks button.
 */
export function BookmarkMark({ label, align }: { label: string; align: "start" | "end" }) {
  const { t } = useI18n();
  return (
    <div
      data-bookmark-mark=""
      title={t("bookmarks.mark", { label })}
      style={{
        display: "flex",
        justifyContent: align === "end" ? "flex-end" : "flex-start",
        margin: "6px 0 2px",
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          maxWidth: "100%",
          padding: "1px 8px",
          border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
          borderRadius: 999,
          background: "color-mix(in srgb, var(--accent) 10%, transparent)",
          color: "var(--accent)",
          fontSize: "calc(11px + var(--chat-font-size-offset, 0px))",
          lineHeight: 1.6,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </span>
    </div>
  );
}

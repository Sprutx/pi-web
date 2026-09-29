import { NextResponse } from "next/server";
import { jsonResponse } from "@/lib/json-response";
import { collectBookmarks } from "@/lib/bookmarks";
import { listAllSessions } from "@/lib/session-reader";
import { startServerPerf } from "@/lib/perf";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookmarks?cwd=<path>
 *
 * One index of every label across every session. `cwd` narrows the result to a
 * single project; without it the index spans all of them.
 */
export async function GET(req: Request) {
  const perf = startServerPerf("GET /api/bookmarks");
  try {
    const cwd = new URL(req.url).searchParams.get("cwd") ?? undefined;
    perf?.span("list");
    const sessions = await listAllSessions();
    const bookmarks = await collectBookmarks(sessions, { cwd, signal: req.signal });
    perf?.span("collect");
    return perf?.attach(jsonResponse(req, { bookmarks }, { headers: { "Cache-Control": "no-store" } }))
      ?? jsonResponse(req, { bookmarks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

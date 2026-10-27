import { statSync } from "fs";
import { resolve as resolvePath } from "path";
import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { getRpcSession } from "@/lib/rpc-manager";
import { applySessionMove, planSessionMove } from "@/lib/session-move";
import {
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  invalidateSessionPathCache,
  listAllSessions,
  readSessionHeader,
  resolveSessionPath,
} from "@/lib/session-reader";

// POST /api/sessions/[id]/move  body: { cwd: string }
// Moves a session and its subagent descendants into another project folder.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { cwd } = await req.json() as { cwd?: unknown };
    if (typeof cwd !== "string" || !cwd.trim()) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const targetCwd = resolvePath(cwd.trim());
    try {
      if (!statSync(targetCwd).isDirectory()) throw new Error("not a directory");
    } catch {
      return NextResponse.json({ error: `Directory does not exist: ${targetCwd}` }, { status: 400 });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!readSessionHeader(filePath)) {
      // A transient session has a path before its first disk write; the move
      // button is hidden for those rows, this only keeps the API honest.
      return NextResponse.json({ error: "Session file is not ready" }, { status: 409 });
    }

    const plan = planSessionMove({ filePath, targetCwd, sessions: await listAllSessions({ force: true }) });
    if (!plan) {
      return NextResponse.json({ ok: true, moved: 0, updated: 0, cwd: targetCwd, path: filePath });
    }

    // A live wrapper appends to its file: moving it mid-run would split the
    // transcript across two paths.
    const touched = [...plan.moves, ...plan.references];
    for (const file of touched) {
      if (getRpcSession(file.id)?.isRunning()) {
        return NextResponse.json({ error: "Session is running" }, { status: 409 });
      }
    }
    // Idle wrappers hold the old path in memory; close them so the next read
    // reopens the moved file — the same teardown DELETE performs.
    for (const file of touched) {
      await getRpcSession(file.id)?.shutdown();
    }

    applySessionMove(plan);

    for (const file of plan.moves) {
      invalidateSessionPathCache(file.id);
      invalidateSessionManagerCache(file.fromPath);
      invalidateSessionManagerCache(file.toPath);
    }
    for (const reference of plan.references) invalidateSessionManagerCache(reference.path);
    invalidateSessionListCache();
    allowFileRoot(targetCwd);

    return NextResponse.json(
      {
        ok: true,
        moved: plan.moves.length,
        updated: plan.references.length,
        cwd: targetCwd,
        path: plan.moves[0].toPath,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

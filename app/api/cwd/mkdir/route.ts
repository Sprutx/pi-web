import { NextResponse } from "next/server";
import { mkdir, realpath, stat } from "fs/promises";
import path from "path";
import { normalizeDirectory } from "@/lib/directory-browser";

// POST /api/cwd/mkdir  body: { parent: string, name: string }
// Creates a single child directory inside parent and returns its path.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { parent?: unknown; name?: unknown };
    const parent = typeof body.parent === "string" ? body.parent.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!parent) return NextResponse.json({ error: "Parent directory is required" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    if (name === "." || name === ".." || name.includes("\0") || /[\\/]/.test(name)) {
      return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }

    let resolvedParent: string;
    try {
      resolvedParent = await realpath(normalizeDirectory(parent));
    } catch {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    const parentStat = await stat(resolvedParent);
    if (!parentStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    const target = path.join(resolvedParent, name);
    try {
      await mkdir(target, { recursive: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return NextResponse.json({ error: `Folder already exists: ${name}` }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ path: target });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

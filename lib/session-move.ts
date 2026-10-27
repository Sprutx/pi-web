import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readSessionHeader } from "./session-reader";
import { sessionPathKey } from "./session-path";
import { SUBAGENT_META_TYPE } from "./subagents";
import type { SessionHeader, SessionInfo } from "./types";

/**
 * Move sessions from one project folder to another.
 *
 * A session belongs to a project twice over: its JSONL file lives in the
 * SDK's `sessions/<encoded-cwd>/` directory (the folder `pi --resume` lists
 * for that project) and its header `cwd` is what pi-web groups rows by. Both
 * move together, together with every persisted subagent below the session.
 * Forks are independent sessions: they stay where they are and only their
 * `parentSession` link is re-pointed at the moved file.
 */
export interface SessionMoveFile {
  id: string;
  fromPath: string;
  toPath: string;
  /** `header.parentSession` after the move; set for subagent descendants. */
  parentToPath?: string;
}

export interface SessionMoveReference {
  id: string;
  path: string;
  parentToPath: string;
}

export interface SessionMovePlan {
  targetCwd: string;
  targetDir: string;
  rootId: string;
  moves: SessionMoveFile[];
  references: SessionMoveReference[];
}

/** Session directory the SDK stores this project folder's sessions in. */
export function sessionDirForCwd(cwd: string): string {
  return SessionManager.create(resolvePath(cwd)).getSessionDir();
}

/**
 * Work out the whole move from the session list: the root file plus every
 * subagent below it. Returns null when the session already sits in the target
 * folder with the target cwd — nothing to do.
 */
export function planSessionMove(options: {
  filePath: string;
  targetCwd: string;
  sessions: readonly SessionInfo[];
}): SessionMovePlan | null {
  const fromPath = resolvePath(options.filePath);
  const targetCwd = resolvePath(options.targetCwd);
  const header = readSessionHeader(fromPath);
  if (!header) throw new Error(`Not a session file: ${fromPath}`);

  const targetDir = sessionDirForCwd(targetCwd);
  const rootToPath = join(targetDir, basename(fromPath));
  if (
    sessionPathKey(dirname(fromPath)) === sessionPathKey(targetDir)
    && header.cwd === targetCwd
  ) return null;

  const childrenByParent = new Map<string, SessionInfo[]>();
  for (const session of options.sessions) {
    if (!session.parentSessionId) continue;
    const children = childrenByParent.get(session.parentSessionId) ?? [];
    children.push(session);
    childrenByParent.set(session.parentSessionId, children);
  }

  const moves: SessionMoveFile[] = [{ id: header.id, fromPath, toPath: rootToPath }];
  const toPathById = new Map<string, string>([[header.id, rootToPath]]);
  const queue: Array<{ id: string; toPath: string }> = [{ id: header.id, toPath: rootToPath }];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of childrenByParent.get(parent.id) ?? []) {
      // Subagent runs travel with their parent; forks are independent sessions.
      if (child.relation?.kind !== "subagent" || toPathById.has(child.id)) continue;
      const toPath = join(targetDir, basename(child.path));
      toPathById.set(child.id, toPath);
      moves.push({ id: child.id, fromPath: child.path, toPath, parentToPath: parent.toPath });
      queue.push({ id: child.id, toPath });
    }
  }

  const references: SessionMoveReference[] = [];
  for (const session of options.sessions) {
    const parentId = session.parentSessionId;
    if (!parentId || toPathById.has(session.id)) continue;
    const parentToPath = toPathById.get(parentId);
    if (!parentToPath) continue;
    references.push({ id: session.id, path: session.path, parentToPath });
  }

  return { targetCwd, targetDir, rootId: header.id, moves, references };
}

/**
 * Execute a plan. Each file is relocated first (rename; copy across
 * filesystems) and only then re-written, so a failure leaves one copy of the
 * session with a stale cwd instead of a duplicate id or a lost transcript.
 */
export function applySessionMove(plan: SessionMovePlan): void {
  for (const file of plan.moves) {
    const header = readSessionHeader(file.fromPath);
    if (!header) throw new Error(`Not a session file: ${file.fromPath}`);
    const target: SessionHeader = { ...header, cwd: plan.targetCwd };
    if (file.parentToPath) target.parentSession = file.parentToPath;

    if (sessionPathKey(file.fromPath) !== sessionPathKey(file.toPath)) {
      mkdirSync(dirname(file.toPath), { recursive: true });
      if (existsSync(file.toPath)) throw new Error(`Session already exists at the target: ${file.toPath}`);
      try {
        renameSync(file.fromPath, file.toPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        copyFileSync(file.fromPath, file.toPath);
        unlinkSync(file.fromPath);
      }
    }
    rewriteSessionFile(file.toPath, target, file.parentToPath);
  }

  for (const reference of plan.references) {
    const header = readSessionHeader(reference.path);
    // The referencing session may have been deleted since the plan was built.
    if (!header || header.parentSession === reference.parentToPath) continue;
    rewriteSessionFile(reference.path, { ...header, parentSession: reference.parentToPath });
  }
}

/** Rewrite the header line (and the subagent parent link) of one JSONL file. */
function rewriteSessionFile(filePath: string, header: SessionHeader, parentToPath?: string): void {
  const content = readFileSync(filePath, "utf8");
  const firstNewline = content.indexOf("\n");
  const body = firstNewline === -1 ? "" : content.slice(firstNewline + 1);
  const nextHeader = JSON.stringify(header);
  const nextBody = parentToPath ? patchSubagentParent(body, parentToPath) : body;
  if (firstNewline !== -1 && content.slice(0, firstNewline) === nextHeader && nextBody === body) return;
  writePrivateFileAtomicSync(filePath, `${nextHeader}\n${nextBody}`);
}

function patchSubagentParent(body: string, parentToPath: string): string {
  const newline = body.indexOf("\n");
  const metaLine = newline === -1 ? body : body.slice(0, newline);
  if (!metaLine) return body;
  try {
    const meta = JSON.parse(metaLine) as { type?: string; customType?: string; data?: unknown };
    if (meta.type !== "custom" || meta.customType !== SUBAGENT_META_TYPE) return body;
    const data = meta.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return body;
    const record = data as Record<string, unknown>;
    if (record.parentSessionPath === parentToPath) return body;
    const patched = JSON.stringify({ ...meta, data: { ...record, parentSessionPath: parentToPath } });
    return newline === -1 ? patched : `${patched}${body.slice(newline)}`;
  } catch {
    // A malformed meta line only loses a cosmetic path, never the relation.
    return body;
  }
}

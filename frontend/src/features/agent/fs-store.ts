import {
  constants,
  existsSync,
  promises as fs,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import type { FsEntry } from "@/features/agent/filesystem-types";
import { resolveAllowedWorkspace } from "@local-studio/agent-runtime/projects-store";

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "dist-desktop",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".local-studio",
]);

const SYSTEM_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
]);

const RESOLVED_SYSTEM_ROOTS = new Set(
  [...SYSTEM_ROOTS].map((entry) => {
    try {
      return realpathSync(entry);
    } catch {
      return entry;
    }
  }),
);

export function assertWorkspaceRoot(rootCwd: string): string {
  const resolved = path.resolve(rootCwd);
  const real = resolveAllowedWorkspace(resolved);
  if (
    SYSTEM_ROOTS.has(resolved) ||
    SYSTEM_ROOTS.has(real) ||
    RESOLVED_SYSTEM_ROOTS.has(real) ||
    real === path.parse(real).root
  ) {
    throw new Error("Path is not an allowed workspace root");
  }
  return real;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

const FileSystemErrorSchema = Schema.Struct({ code: Schema.String });
const decodeFileSystemError = Schema.decodeUnknownOption(FileSystemErrorSchema);

function resolveMissingContainedPath(root: string, candidate: string): string {
  try {
    const stats = lstatSync(candidate);
    if (stats.isSymbolicLink()) throw new Error("Path must not be a symbolic link");
    throw new Error("Path exists but cannot be resolved");
  } catch (lstatError) {
    const decoded = decodeFileSystemError(lstatError);
    if (decoded._tag === "None" || decoded.value.code !== "ENOENT") throw lstatError;
  }

  let ancestor = path.dirname(candidate);
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("Path has no existing parent");
    ancestor = parent;
  }
  const realAncestor = realpathSync(ancestor);
  if (!isInside(root, realAncestor)) throw new Error("Path escapes project root");
  const suffix = path.relative(ancestor, candidate);
  if (path.isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${path.sep}`)) {
    throw new Error("Path escapes project root");
  }
  return path.join(realAncestor, suffix);
}

export function resolveContainedPath(
  rootPath: string,
  targetPath: string,
  allowMissing = false,
): string {
  const requestedRoot = path.resolve(rootPath);
  const root = realpathSync(requestedRoot);
  const candidate = path.resolve(targetPath);
  if (!isInside(requestedRoot, candidate) && !isInside(root, candidate)) {
    throw new Error("Path escapes project root");
  }

  try {
    const realTarget = realpathSync(candidate);
    if (!isInside(root, realTarget)) throw new Error("Path escapes project root");
    return realTarget;
  } catch (error) {
    const decoded = decodeFileSystemError(error);
    if (!allowMissing || decoded._tag === "None" || decoded.value.code !== "ENOENT") throw error;
    return resolveMissingContainedPath(root, candidate);
  }
}

export function resolveContainedFilePath(
  rootPath: string,
  targetPath: string,
  allowMissing = false,
): string {
  const root = realpathSync(rootPath);
  const candidate = path.resolve(targetPath);
  const parent = resolveContainedPath(root, path.dirname(candidate), allowMissing);
  const target = path.join(parent, path.basename(candidate));
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink()) throw new Error("Path must not be a symbolic link");
    return target;
  } catch (error) {
    const decoded = decodeFileSystemError(error);
    if (!allowMissing || decoded._tag === "None" || decoded.value.code !== "ENOENT") throw error;
    return target;
  }
}

function resolveWorkspacePath(rootCwd: string, relPath: string, noFollow = false): string {
  if (path.isAbsolute(relPath)) throw new Error("Path must be relative to project root");
  const root = assertWorkspaceRoot(rootCwd);
  const target = path.resolve(root, relPath);
  return noFollow ? resolveContainedFilePath(root, target) : resolveContainedPath(root, target);
}

export async function openRegularFile(filePath: string, flags: number, mode?: number) {
  const file = await fs.open(filePath, flags | constants.O_NOFOLLOW, mode);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Not a file");
    return { file, stats };
  } catch (error) {
    await file.close();
    throw error;
  }
}

export async function withRegularFile<T>(
  filePath: string,
  flags: number,
  action: (opened: Awaited<ReturnType<typeof openRegularFile>>) => Promise<T>,
  mode?: number,
): Promise<T> {
  const opened = await openRegularFile(filePath, flags, mode);
  try {
    return await action(opened);
  } finally {
    await opened.file.close();
  }
}

export function listDirectory(rootCwd: string, relPath: string): FsEntry[] {
  const root = assertWorkspaceRoot(rootCwd);
  const target = resolveWorkspacePath(root, relPath || ".");
  if (!existsSync(target)) throw new Error("Not found");
  const stats = statSync(target);
  if (!stats.isDirectory()) throw new Error("Not a directory");

  const names = readdirSync(target);
  const entries: FsEntry[] = [];
  for (const name of names) {
    if (IGNORE_DIRS.has(name)) continue;
    if (name.startsWith(".") && name !== ".env.example") continue;
    const abs = path.join(target, name);
    let s: ReturnType<typeof lstatSync>;
    try {
      s = lstatSync(abs);
    } catch {
      continue;
    }
    if (s.isSymbolicLink()) continue;
    entries.push({
      name,
      path: abs,
      rel: path.relative(root, abs),
      kind: s.isDirectory() ? "directory" : "file",
      size: s.isFile() ? s.size : undefined,
      modifiedAt: s.mtime.toISOString(),
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

const SEARCH_MAX_VISITED = 20_000;
const SEARCH_MAX_DEPTH = 12;

function fileMatch(query: string, name: string, relativePath: string): "name" | "path" | undefined {
  if (!query || name.toLowerCase().includes(query)) return "name";
  if (relativePath.toLowerCase().includes(query)) return "path";
}

type SearchDirectory = { dir: string; depth: number };
function searchCandidate(
  root: string,
  query: string,
  current: SearchDirectory,
  name: string,
  queue: SearchDirectory[],
): FsEntry | undefined {
  if (IGNORE_DIRS.has(name) || (name.startsWith(".") && name !== ".env.example")) return undefined;
  const abs = path.join(current.dir, name);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(abs);
  } catch {
    return undefined;
  }
  if (stats.isDirectory()) {
    if (current.depth < SEARCH_MAX_DEPTH) queue.push({ dir: abs, depth: current.depth + 1 });
    return undefined;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return undefined;
  const rel = path.relative(root, abs);
  const match = fileMatch(query, name, rel);
  if (!match) return undefined;
  return {
    name,
    path: abs,
    rel,
    kind: "file",
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

export function searchFiles(rootCwd: string, query: string, limit = 20): FsEntry[] {
  const root = assertWorkspaceRoot(rootCwd);
  const q = query.trim().toLowerCase();
  const nameMatches: FsEntry[] = [];
  const pathMatches: FsEntry[] = [];
  const queue: SearchDirectory[] = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && nameMatches.length < limit && visited < SEARCH_MAX_VISITED) {
    const current = queue.shift();
    if (!current) break;
    let names: string[];
    try {
      names = readdirSync(current.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (visited >= SEARCH_MAX_VISITED || nameMatches.length >= limit) break;
      visited += 1;
      const entry = searchCandidate(root, q, current, name, queue);
      if (!entry) continue;
      if (!q || name.toLowerCase().includes(q)) nameMatches.push(entry);
      else pathMatches.push(entry);
    }
  }
  return [...nameMatches, ...pathMatches].slice(0, limit);
}

export async function readFileSnippet(
  rootCwd: string,
  relPath: string,
  maxBytes = 5 * 1024 * 1024,
): Promise<{ content: string; truncated: boolean; size: number }> {
  const root = assertWorkspaceRoot(rootCwd);
  const target = resolveWorkspacePath(root, relPath, true);
  return withRegularFile(target, constants.O_RDONLY, async ({ file, stats }) => {
    if (stats.size > maxBytes) return { content: "", truncated: true, size: stats.size };
    const buf = await file.readFile();
    const truncated = buf.subarray(0, Math.min(buf.length, 8192)).includes(0);
    return {
      content: truncated ? "" : buf.toString("utf-8"),
      truncated,
      size: stats.size,
    };
  });
}

export async function openReadableFile(
  rootCwd: string,
  relPath: string,
): Promise<{ file: FileHandle; size: number; modifiedAt: Date }> {
  const root = assertWorkspaceRoot(rootCwd);
  const target = resolveWorkspacePath(root, relPath, true);
  const { file, stats } = await openRegularFile(target, constants.O_RDONLY);
  return { file, size: stats.size, modifiedAt: stats.mtime };
}

export async function writeFileContent(
  rootCwd: string,
  relPath: string,
  content: string,
): Promise<void> {
  const root = assertWorkspaceRoot(rootCwd);
  const target = resolveWorkspacePath(root, relPath, true);
  await withRegularFile(target, constants.O_WRONLY, async ({ file }) => {
    await file.truncate(0);
    await file.writeFile(content, "utf8");
  });
}

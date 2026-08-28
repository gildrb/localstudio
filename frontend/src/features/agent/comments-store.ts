import { constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import {
  assertWorkspaceRoot,
  resolveContainedFilePath,
  withRegularFile,
} from "@/features/agent/fs-store";

export type Comment = {
  id: string;
  line: number;
  body: string;
  createdAt: string;
};

type CommentsDocument = {
  // Map of relative path → comments. Stored on disk as
  // <project>/.local-studio/comments.json.
  files: Record<string, Comment[]>;
};

const CommentSchema = Schema.Struct({
  id: Schema.String,
  line: Schema.Number,
  body: Schema.String,
  createdAt: Schema.String,
});
const CommentsDocumentSchema = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.Array(CommentSchema)),
});
const decodeCommentsDocument = Schema.decodeUnknownSync(CommentsDocumentSchema);

function commentsPath(rootCwd: string, allowMissing = false): string {
  const root = assertWorkspaceRoot(rootCwd);
  return resolveContainedFilePath(
    root,
    path.join(root, ".local-studio", "comments.json"),
    allowMissing,
  );
}

async function readDocument(rootCwd: string): Promise<CommentsDocument> {
  try {
    const raw = await withRegularFile(commentsPath(rootCwd), constants.O_RDONLY, ({ file }) =>
      file.readFile("utf-8"),
    );
    const parsed: unknown = JSON.parse(raw);
    const document = decodeCommentsDocument(parsed);
    return {
      files: Object.fromEntries(
        Object.entries(document.files).map(([file, comments]) => [
          file,
          comments.map((comment) => ({ ...comment })),
        ]),
      ),
    };
  } catch {
    return { files: {} };
  }
}

async function writeDocument(rootCwd: string, document: CommentsDocument): Promise<void> {
  const pendingPath = commentsPath(rootCwd, true);
  await mkdir(path.dirname(pendingPath), { recursive: true });
  const filePath = commentsPath(rootCwd, true);
  await withRegularFile(
    filePath,
    constants.O_WRONLY | constants.O_CREAT,
    async ({ file }) => {
      await file.truncate(0);
      await file.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf-8");
    },
    0o600,
  );
}

function ensureRel(rel: string): string {
  const normalized = path.normalize(rel);
  if (
    !rel ||
    rel.includes("\0") ||
    path.isAbsolute(rel) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Invalid file path");
  }
  return normalized;
}

export async function listComments(rootCwd: string, rel: string): Promise<Comment[]> {
  const safe = ensureRel(rel);
  const doc = await readDocument(rootCwd);
  return doc.files[safe] ?? [];
}

export async function addComment(
  rootCwd: string,
  rel: string,
  line: number,
  body: string,
): Promise<Comment> {
  const safe = ensureRel(rel);
  const doc = await readDocument(rootCwd);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment body is required");
  const comment: Comment = {
    id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    line,
    body: trimmed,
    createdAt: new Date().toISOString(),
  };
  await writeDocument(rootCwd, {
    files: { ...doc.files, [safe]: [...(doc.files[safe] ?? []), comment] },
  });
  return comment;
}

export async function deleteComment(rootCwd: string, rel: string, id: string): Promise<void> {
  const safe = ensureRel(rel);
  const doc = await readDocument(rootCwd);
  const list = doc.files[safe];
  if (!list) return;
  const filtered = list.filter((c) => c.id !== id);
  if (filtered.length === list.length) return;
  await writeDocument(rootCwd, {
    files: { ...doc.files, [safe]: filtered },
  });
}

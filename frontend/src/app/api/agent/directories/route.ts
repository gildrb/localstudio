import { NextRequest } from "next/server";
import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  allowedWorkspaceRoots,
  resolveAllowedWorkspace,
} from "@local-studio/agent-runtime/projects-store";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DirectoryEntry = {
  name: string;
  path: string;
};

function isLoopbackHost(host: string | null): boolean {
  const value = host ?? "";
  const hostname = value.startsWith("[")
    ? value.slice(1, value.indexOf("]"))
    : value.split(":")[0]?.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function allowedDirectory(input: string | null, fallback: string): string | null {
  try {
    return resolveAllowedWorkspace(input?.trim() || fallback);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const remoteBrowserEnabled = process.env.LOCAL_STUDIO_ENABLE_REMOTE_DIRECTORY_BROWSER === "1";
  if (!isLoopbackHost(request.headers.get("host")) && !remoteBrowserEnabled) {
    return jsonError("Directory browsing is only available locally", 403);
  }

  let roots: string[];
  try {
    roots = allowedWorkspaceRoots();
  } catch (error) {
    return jsonError(errorMessage(error, "Workspace roots are invalid"), 500);
  }
  const directoryPath = allowedDirectory(request.nextUrl.searchParams.get("path"), roots[0] ?? "");
  if (!directoryPath) return jsonError("Path is outside WORKSPACE_ROOTS", 403);

  try {
    const names = await readdir(directoryPath);
    const entries = (
      await Promise.all(
        names.map(async (name): Promise<DirectoryEntry | null> => {
          if (name === "." || name === "..") return null;
          const entryPath = allowedDirectory(path.join(directoryPath, name), roots[0] ?? "");
          return entryPath ? { name, path: entryPath } : null;
        }),
      )
    )
      .filter((entry): entry is DirectoryEntry => entry !== null)
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
      );
    const parentPath = path.dirname(directoryPath);
    const parent =
      parentPath === directoryPath ? null : allowedDirectory(parentPath, roots[0] ?? "");
    return Response.json({
      path: directoryPath,
      parent,
      roots,
      entries,
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list directories"));
  }
}

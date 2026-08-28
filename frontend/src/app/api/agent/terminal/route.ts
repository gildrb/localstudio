import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { Schema } from "effect";
import { parseTerminalRunRequest } from "@/features/agent/contracts";
import { requireApiAccess } from "@/lib/auth/guard";
import { assertWorkspaceRoot } from "@/features/agent/fs-store";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const TerminalExecErrorSchema = Schema.Struct({
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
});

function parseGitReviewCommand(command: string): string[] | null {
  const commands = [
    { prefix: "git restore --staged -- ", args: ["restore", "--staged", "--"] },
    { prefix: "git restore -- ", args: ["restore", "--"] },
    { prefix: "git add -- ", args: ["add", "--"] },
  ];
  const match = commands.find(({ prefix }) => command.startsWith(prefix));
  if (!match) return null;
  const encoded = command.slice(match.prefix.length);
  if (!encoded.startsWith("'") || !encoded.endsWith("'")) return null;
  const filePath = encoded.slice(1, -1).replaceAll(`'"'"'`, "'");
  if (`'${filePath.replaceAll("'", `'"'"'`)}'` !== encoded) return null;
  const normalized = path.normalize(filePath);
  if (
    !filePath ||
    /[\0\r\n]/.test(filePath) ||
    path.isAbsolute(filePath) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  )
    return null;
  return [...match.args, normalized];
}

function assertTerminalCwd(
  request: NextRequest,
): { cwd: string; error?: never } | { cwd?: never; error: Response } {
  const required = requireAbsoluteCwd(request);
  if (required.response) return { error: required.response };
  const cwd = path.resolve(required.cwd);
  try {
    if (!statSync(cwd).isDirectory()) return { error: jsonError("cwd is not a directory") };
  } catch {
    return { error: jsonError("cwd not found", 404) };
  }
  try {
    assertWorkspaceRoot(cwd);
  } catch (err) {
    return { error: jsonError(errorMessage(err, "cwd is not an allowed workspace"), 403) };
  }
  return { cwd };
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const { cwd, error } = assertTerminalCwd(request);
  if (error) return error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const parsed = parseTerminalRunRequest(body);
  if (!parsed.ok) return jsonError(parsed.error);
  const args = parseGitReviewCommand(parsed.value.command);
  if (!args) return jsonError("Unsupported terminal command");
  try {
    const { stdout, stderr } = await execFileAsync("git", ["--literal-pathspecs", ...args], {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    return Response.json({ ok: true, command: parsed.value.command, stdout, stderr, exitCode: 0 });
  } catch (err) {
    const decoded = Schema.decodeUnknownOption(TerminalExecErrorSchema)(err);
    const error = decoded._tag === "Some" ? decoded.value : {};
    return Response.json({
      ok: false,
      command: parsed.value.command,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.code ?? null,
      error: error.message ?? "Command failed",
    });
  }
}

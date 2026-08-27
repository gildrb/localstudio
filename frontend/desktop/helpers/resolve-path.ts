import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let cachedPath: string | null = null;
function loginShellPath(): string | null {
  if (process.platform === "win32") return null;
  const shell = process.env.SHELL || "/bin/zsh";
  const start = "__VLLM_PATH_START__";
  const end = "__VLLM_PATH_END__";
  try {
    const output = execFileSync(shell, ["-ilc", `printf '%s%s%s' '${start}' "$PATH" '${end}'`], {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const from = output.indexOf(start);
    const to = output.indexOf(end);
    if (from === -1 || to === -1 || to <= from) return null;
    return output.slice(from + start.length, to).trim() || null;
  } catch {
    return null;
  }
}

export function resolveAugmentedPath(): string {
  if (cachedPath) return cachedPath;
  const home = os.homedir();
  const common = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    ...[".local", ".cargo", ".bun", ".volta", ".deno"].map((dir) => path.join(home, dir, "bin")),
  ].filter(existsSync);
  const segments = [loginShellPath(), process.env.PATH, ...common]
    .flatMap((entry) => entry?.split(path.delimiter) ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  cachedPath = [...new Set(segments)].join(path.delimiter);
  return cachedPath;
}

import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { frontendDir, git, repoRoot, run } from "./lib.mjs";

function parsedVersion(value) {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function versionMeetsMinimum(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function requireTool(label, command, args, minimum) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error || result.status !== 0) throw Error(`${label} is required but unavailable`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const actual = parsedVersion(output);
  if (!actual || !versionMeetsMinimum(actual, minimum)) {
    throw Error(`${label} ${minimum.join(".")} or newer is required; found ${output || "unknown"}`);
  }
  console.log(`${label}: ${actual.join(".")}`);
}

export function doctor() {
  for (const [label, command, minimum] of [
    ["Node.js", process.execPath, [22, 19, 0]],
    ["npm", "npm", [10, 0, 0]],
    ["Bun", "bun", [1, 3, 14]],
    ["Python", "python3", [3, 10, 0]],
    ["Git", "git", [2, 0, 0]],
  ])
    requireTool(label, command, ["--version"], minimum);
  console.log("Toolchain check passed");
}

export function setupRepository() {
  doctor();
  for (const directory of ["controller", "shared", "services/agent-runtime"]) {
    run("bun", ["install", "--frozen-lockfile"], path.join(repoRoot, directory));
  }
  run("npm", ["ci", "--legacy-peer-deps"], frontendDir);
  console.log("Repository setup complete");
}

export function linkServices() {
  const servicesDir = path.join(repoRoot, "services");
  const linkPath = path.join(servicesDir, "node_modules");
  mkdirSync(servicesDir, { recursive: true });

  let kind = "missing";
  try {
    const stat = lstatSync(linkPath);
    kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file";
  } catch {}
  if (kind === "directory") {
    console.error(`[link-services] ${linkPath} is a real directory; leaving it alone.`);
    process.exit(0);
  }
  if (kind !== "missing") rmSync(linkPath, { recursive: true, force: true });

  if (process.platform === "win32") {
    symlinkSync(path.join(frontendDir, "node_modules"), linkPath, "junction");
  } else {
    symlinkSync(path.join("..", "frontend", "node_modules"), linkPath, "dir");
  }
}

export function setupHooks() {
  const worktree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (worktree.status !== 0 || worktree.stdout.trim() !== "true") {
    console.log("Skipping Git hook setup outside a worktree");
    return;
  }
  git(["rev-parse", "--git-dir"]);
  git(["config", "core.hooksPath", ".githooks"]);
  for (const name of readdirSync(path.join(repoRoot, ".githooks"))) {
    chmodSync(path.join(repoRoot, ".githooks", name), 0o755);
  }
}

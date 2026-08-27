import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG, resolveStandaloneBaseDir, resolveStaticAssetsSource } from "../configs";
import type { DesktopServerRuntime } from "../types";
import { log } from "../helpers/logger";
import { registerOAuthVault } from "./oauth-vault";
import { resolveStablePort } from "../helpers/ports";
import { resolveAugmentedPath } from "../helpers/resolve-path";
import {
  startOrReuseAgentRuntime,
  stopAgentRuntime,
  type AgentRuntimeHandle,
} from "./agent-runtime-server";
let currentEmbeddedServer: ChildProcess | null = null;
process.once("exit", () => {
  if (currentEmbeddedServer && !currentEmbeddedServer.killed) {
    currentEmbeddedServer.kill("SIGTERM");
  }
});

interface ServerHandle {
  agentRuntimeExitListener?: () => void;
  agentRuntime: AgentRuntimeHandle;
  runtime: DesktopServerRuntime;
  process?: ChildProcess;
}

type ServerExitDetails = {
  code: number | null;
  signal: NodeJS.Signals | null;
  pid?: number;
};

type StartFrontendServerOptions = {
  agentRuntime?: AgentRuntimeHandle;
  port?: number;
  onExit?: (details: ServerExitDetails) => void;
};

type StopFrontendServerOptions = {
  stopAgentRuntime?: boolean;
};

function embeddedServerPidPath(): string {
  return path.join(DESKTOP_CONFIG.userDataDir, "embedded-frontend.pid");
}

function embeddedServerPortPath(): string {
  return path.join(DESKTOP_CONFIG.userDataDir, "embedded-frontend.port");
}

function readPersistedPort(): number | undefined {
  try {
    const raw = readFileSync(embeddedServerPortPath(), "utf8").trim();
    const port = Number(raw);
    return Number.isInteger(port) && port > 1024 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

function persistPort(port: number): void {
  try {
    mkdirSync(DESKTOP_CONFIG.userDataDir, { recursive: true });
    writeFileSync(embeddedServerPortPath(), String(port));
  } catch {}
}

function writeEmbeddedServerPid(pid: number | undefined, serverScript: string): void {
  try {
    mkdirSync(DESKTOP_CONFIG.userDataDir, { recursive: true });
    writeFileSync(embeddedServerPidPath(), `${pid ?? ""}\n${serverScript}`);
  } catch {}
}

function readEmbeddedServerIdentity(): { pid: number; serverScript: string } | null {
  try {
    const [pidLine, ...scriptLines] = readFileSync(embeddedServerPidPath(), "utf8").split("\n");
    const pid = Number(pidLine);
    const serverScript = scriptLines.join("\n");
    return Number.isInteger(pid) && pid > 0 && serverScript ? { pid, serverScript } : null;
  } catch {
    return null;
  }
}

function clearEmbeddedServerPid(pid: number | undefined): void {
  if (readEmbeddedServerIdentity()?.pid === pid) rmSync(embeddedServerPidPath(), { force: true });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function processRunsScript(pid: number, expectedScript: string): boolean {
  if (!isProcessAlive(pid) || process.platform === "win32") return false;
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2_000,
    }).includes(expectedScript);
  } catch {
    return false;
  }
}

async function killStaleEmbeddedServer(expectedScript: string): Promise<void> {
  const identity = readEmbeddedServerIdentity();
  rmSync(embeddedServerPidPath(), { force: true });
  if (
    !identity ||
    identity.serverScript !== expectedScript ||
    identity.pid === process.pid ||
    !processRunsScript(identity.pid, expectedScript)
  ) {
    return;
  }
  try {
    process.kill(identity.pid, "SIGTERM");
  } catch {
    return;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_500 && processRunsScript(identity.pid, expectedScript)) {
    await delay(100);
  }
  if (!processRunsScript(identity.pid, expectedScript)) return;
  try {
    process.kill(identity.pid, "SIGKILL");
  } catch {}
}

function resolveStandaloneServerRoot(): string {
  const standaloneBase = resolveStandaloneBaseDir();
  const nestedRoot = path.join(standaloneBase, "frontend");
  if (existsSync(path.join(nestedRoot, "server.js"))) {
    return nestedRoot;
  }
  return standaloneBase;
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new Error(`Missing source directory: ${source}`);
  }
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
    } catch {}
    await delay(300);
  }

  throw new Error(`Timed out waiting for embedded frontend server: ${url}`);
}

export async function startFrontendServer(
  options: StartFrontendServerOptions = {},
): Promise<ServerHandle> {
  if (process.env.LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL) {
    const runtime: DesktopServerRuntime = {
      mode: "dev-server",
      port: Number(new URL(DESKTOP_CONFIG.devServerUrl).port || "3000"),
      url: DESKTOP_CONFIG.devServerUrl,
    };
    const agentRuntime = await startOrReuseAgentRuntime(
      { frontendUrl: runtime.url, preferredPort: 8081 },
      options.agentRuntime,
    );
    return { agentRuntime, runtime };
  }

  const serverRoot = resolveStandaloneServerRoot();
  const serverScript = path.join(serverRoot, "server.js");

  if (!existsSync(serverScript)) {
    throw new Error(`Missing standalone server build: ${serverScript}. Run npm run build first.`);
  }
  await killStaleEmbeddedServer(serverScript);

  const { staticDir, publicDir } = resolveStaticAssetsSource();
  const targetStaticDir = path.join(serverRoot, ".next", "static");
  const targetPublicDir = path.join(serverRoot, "public");

  if (app.isPackaged) {
    if (!existsSync(targetStaticDir)) {
      throw new Error(`Missing packaged static assets: ${targetStaticDir}`);
    }
    if (!existsSync(targetPublicDir)) {
      throw new Error(`Missing packaged public assets: ${targetPublicDir}`);
    }
  } else {
    copyDirectory(staticDir, targetStaticDir);
    copyDirectory(publicDir, targetPublicDir);
  }

  const port = await resolveStablePort(options.port ?? readPersistedPort());
  persistPort(port);
  const url = `http://127.0.0.1:${port}`;
  const agentRuntime = await startOrReuseAgentRuntime({ frontendUrl: url }, options.agentRuntime);

  log.info(`Starting embedded frontend server from ${serverScript} on ${url}`);

  const child = fork(serverScript, {
    cwd: serverRoot,
    stdio: "pipe",
    execArgv: ["--network-family-autoselection-attempt-timeout=2000"],
    detached: false,
    env: {
      ...process.env,
      PATH: resolveAugmentedPath(),
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      LOCAL_STUDIO_DESKTOP: "1",
      LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      LOCAL_STUDIO_PROJECTS_FILE: path.join(DESKTOP_CONFIG.userDataDir, "projects.json"),
      LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
      LOCAL_STUDIO_AGENT_RUNTIME_URL: agentRuntime.url,
      LOCAL_STUDIO_FRONTEND_BASE: url,
    },
  });

  registerOAuthVault(child, DESKTOP_CONFIG.userDataDir);

  child.stdout?.on("data", (chunk: Buffer | string) => {
    log.info(`frontend: ${String(chunk).trim()}`);
  });

  child.stderr?.on("data", (chunk: Buffer | string) => {
    log.warn(`frontend: ${String(chunk).trim()}`);
  });

  writeEmbeddedServerPid(child.pid, serverScript);

  child.once("exit", (code, signal) => {
    clearEmbeddedServerPid(child.pid);
    log.warn(`Embedded frontend exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    options.onExit?.({ code, signal, pid: child.pid });
  });

  const agentRuntimeExitListener = () => {
    if (currentEmbeddedServer === child && !child.killed) child.kill("SIGTERM");
  };
  agentRuntime.process?.once("exit", agentRuntimeExitListener);

  currentEmbeddedServer = child;

  try {
    await waitForServer(url, DESKTOP_CONFIG.startupTimeoutMs);
  } catch (error) {
    await stopFrontendServer(
      {
        agentRuntime,
        agentRuntimeExitListener,
        process: child,
        runtime: { mode: "embedded-standalone", port, url },
      },
      { stopAgentRuntime: agentRuntime !== options.agentRuntime },
    );
    throw error;
  }

  return {
    agentRuntime,
    agentRuntimeExitListener,
    runtime: {
      mode: "embedded-standalone",
      port,
      url,
    },
    process: child,
  };
}

export async function stopFrontendServer(
  handle?: ServerHandle,
  options: StopFrontendServerOptions = {},
): Promise<void> {
  if (!handle) return;
  if (handle.agentRuntimeExitListener) {
    handle.agentRuntime.process?.off("exit", handle.agentRuntimeExitListener);
  }
  if (handle.process) {
    const child = handle.process;
    const pid = child.pid;
    clearEmbeddedServerPid(child.pid);
    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (pid && isProcessAlive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
        resolve();
      }, 5_000);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (options.stopAgentRuntime !== false) await stopAgentRuntime(handle.agentRuntime);
}

export type { ServerHandle };

import { Option, Schema } from "effect";
import { isDevChannelBuild } from "./app-identity";
import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { DesktopAppState } from "./types";
import { DESKTOP_CONFIG } from "./configs";
import { writeJsonAtomic } from "./helpers/fs-json";
import { log } from "./helpers/logger";
import { installApplicationMenu } from "./logic/app-menu";
import { createMainWindow } from "./logic/window-manager";
import { registerNavigationPolicy } from "./logic/security";
import { startFrontendServer, stopFrontendServer, type ServerHandle } from "./logic/app-server";
import {
  resolveFrontendRestartUrl,
  shouldReloadAfterFrontendRestart,
} from "./logic/frontend-restart";
import { getUpdateState, initializeAutoUpdates, startUpdate } from "./logic/update-manager";
import { createProjectsStore } from "./logic/projects-store-core";
import { decodeControllerDeployOptions, deployController } from "./logic/controller-deploy";
import {
  getKittylitterPairingJson,
  normalizeKittylitterPairingJson,
} from "./logic/kittylitter-pairing";
import {
  dismissQuickPanel,
  resizeQuickPanelToThread,
  toggleQuickPanel,
} from "./logic/quick-panel-window";
import { getStoredQuickPanelHotkey, setStoredQuickPanelHotkey } from "./logic/desktop-settings";

type Json = Schema.MutableJson;
type SessionPrefs = { [key: string]: Json };
type UiPreferences = { [key: string]: string };
type IpcValue = Json;

const JsonSchema: Schema.Codec<Json, Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.mutable(Schema.Array(JsonSchema)),
    Schema.Record(Schema.String, JsonSchema),
  ]),
);
const SessionPreferenceSchema = Schema.Struct({
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(10_000))),
  pinned: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
});
const SessionPrefsSchema = Schema.Record(
  Schema.String.check(Schema.isMaxLength(500)),
  SessionPreferenceSchema,
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).length <= 10_000 &&
      Buffer.byteLength(JSON.stringify(value), "utf8") <= 1_000_000,
    { expected: "at most 10,000 session preferences and 1 MB" },
  ),
);
const UiPreferencesSchema = Schema.Record(
  Schema.String.check(Schema.isMaxLength(500)),
  Schema.String.check(Schema.isMaxLength(100_000)),
).check(
  Schema.makeFilter((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 1_000_000, {
    expected: "at most 1 MB of UI preferences",
  }),
);
const decodeStringOption = Schema.decodeUnknownOption(Schema.String);
const decodeSessionPrefsOption = Schema.decodeUnknownOption(SessionPrefsSchema, {
  onExcessProperty: "error",
});
const decodeUiPreferencesOption = Schema.decodeUnknownOption(UiPreferencesSchema);
const PREFERENCES_FILE_MAX_BYTES = 1_000_001;
const stringValue = (value: IpcValue | undefined): string | undefined =>
  Option.getOrUndefined(decodeStringOption(value));
const projects = createProjectsStore({
  projectsFilePath: () => path.join(app.getPath("userData"), "projects.json"),
  chatsProjectId: "chats",
  emptyPathMessage: "Project path is required",
});

let appState: DesktopAppState = "starting";
let mainWindow: BrowserWindow | null = null;
let frontendServer: ServerHandle | undefined;
let restartingFrontend = false;
let frontendHealthTimer: NodeJS.Timeout | undefined;
let frontendHealthFailures = 0;
let restartAttempts = 0;
let lastRestartAt = 0;
let shutdownPromise: Promise<void> | undefined;
let quitAfterShutdown = false;
let relaunchAfterShutdown = false;
const expectedFrontendStopPids = new Set<number>();

const HEALTH_CHECK_INTERVAL_MS = 5_000;
const HEALTH_CHECK_TIMEOUT_MS = 4_000;
const HEALTH_FAILURE_THRESHOLD = 5;
const RESTART_BACKOFF_STEP_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 15_000;
const RESTART_BACKOFF_WINDOW_MS = 60_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isAppStopping(): boolean {
  return appState === "stopping";
}

async function processMemorySummary(): Promise<string> {
  try {
    return `memory=${JSON.stringify(await process.getProcessMemoryInfo())}`;
  } catch {
    return "memory=unavailable";
  }
}

async function bootstrap(): Promise<void> {
  if (!frontendServer) {
    frontendServer = await startFrontendServer({ onExit: handleFrontendServerExit });
    startFrontendHealthMonitor();
  }
  if (!mainWindow) openMainWindow(frontendServer.runtime.url);

  appState = "ready";
  log.info(
    `Desktop ready (mode=${frontendServer.runtime.mode}, url=${frontendServer.runtime.url})`,
  );
}

function stopFrontendHealthMonitor(): void {
  if (!frontendHealthTimer) return;
  clearInterval(frontendHealthTimer);
  frontendHealthTimer = undefined;
  frontendHealthFailures = 0;
}

function currentRendererUrl(): string | undefined {
  return mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.webContents.getURL() || undefined
    : undefined;
}

function openMainWindow(url: string): BrowserWindow {
  const window = createMainWindow(url);
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function startFrontendHealthMonitor(): void {
  stopFrontendHealthMonitor();
  frontendHealthTimer = setInterval(() => {
    void checkFrontendHealth();
  }, HEALTH_CHECK_INTERVAL_MS);
}

async function checkFrontendHealth(): Promise<void> {
  if (!frontendServer || restartingFrontend || appState === "stopping") return;
  if (frontendServer.runtime.mode !== "embedded-standalone") return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    await fetch(`${frontendServer.runtime.url}/api/desktop-health`, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "cache-control": "no-cache" },
    });
    frontendHealthFailures = 0;
    return;
  } catch {
    frontendHealthFailures += 1;
  } finally {
    clearTimeout(timeout);
  }

  if (frontendHealthFailures < HEALTH_FAILURE_THRESHOLD || !frontendServer) return;
  const stalledServer = frontendServer;
  const rendererUrl = currentRendererUrl();
  frontendHealthFailures = 0;
  log.error(`Embedded frontend health check failed; restarting ${stalledServer.runtime.url}`);
  const pid = stalledServer.process?.pid;
  if (pid) {
    expectedFrontendStopPids.add(pid);
    setTimeout(() => expectedFrontendStopPids.delete(pid), 30_000);
  }
  await stopFrontendServer(stalledServer, { stopAgentRuntime: false });
  if (frontendServer === stalledServer) frontendServer = undefined;
  await restartFrontendServer(stalledServer.runtime.port, stalledServer.agentRuntime, rendererUrl);
}

function handleFrontendServerExit(details: {
  code: number | null;
  signal: NodeJS.Signals | null;
  pid?: number;
}) {
  if (appState === "stopping") return;
  if (details.pid && expectedFrontendStopPids.delete(details.pid)) return;
  if (frontendServer?.process && frontendServer.process.pid !== details.pid) return;

  const previousServer = frontendServer;
  const rendererUrl = currentRendererUrl();
  frontendServer = undefined;
  log.error(
    `Embedded frontend stopped unexpectedly code=${details.code ?? "null"} signal=${details.signal ?? "null"}`,
  );
  void restartFrontendServer(
    previousServer?.runtime.port,
    previousServer?.agentRuntime,
    rendererUrl,
  );
}

async function restartFrontendServer(
  port?: number,
  agentRuntime?: ServerHandle["agentRuntime"],
  rendererUrl?: string,
): Promise<void> {
  if (restartingFrontend || appState === "stopping") return;
  restartingFrontend = true;
  appState = "starting";
  try {
    const now = Date.now();
    restartAttempts = now - lastRestartAt < RESTART_BACKOFF_WINDOW_MS ? restartAttempts + 1 : 1;
    lastRestartAt = now;
    const backoffMs = Math.min(
      RESTART_BACKOFF_MAX_MS,
      (restartAttempts - 1) * RESTART_BACKOFF_STEP_MS,
    );
    if (backoffMs > 0) {
      log.warn(`Embedded frontend restart backoff ${backoffMs}ms (attempt ${restartAttempts})`);
      await delay(backoffMs);
      if (isAppStopping()) return;
    }
    const started = await startFrontendServer({
      agentRuntime,
      port,
      onExit: handleFrontendServerExit,
    });
    if (isAppStopping()) {
      await stopFrontendServer(started).catch(() => undefined);
      return;
    }
    frontendServer = started;
    startFrontendHealthMonitor();
    const nextUrl = frontendServer.runtime.url;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const liveUrl = mainWindow.webContents.getURL() || rendererUrl;
      if (shouldReloadAfterFrontendRestart(nextUrl, liveUrl)) {
        await mainWindow.loadURL(resolveFrontendRestartUrl(nextUrl, rendererUrl));
      }
    } else {
      openMainWindow(nextUrl);
    }
    appState = "ready";
    log.info(`Embedded frontend restarted (mode=${frontendServer.runtime.mode}, url=${nextUrl})`);
  } catch (error) {
    log.error(
      `Failed to restart embedded frontend: ${error instanceof Error ? error.stack : String(error)}`,
    );
  } finally {
    restartingFrontend = false;
  }
}

function resolveHomeConfinedPath(target: IpcValue): string | null {
  const raw = stringValue(target)?.trim();
  if (!raw) return null;
  const candidates = [raw];
  if (!path.isAbsolute(raw) && !raw.startsWith("~")) {
    for (const project of projects.listProjects()) {
      if (project.path) candidates.push(path.join(project.path, raw));
    }
  }
  const home = realpathSync.native(app.getPath("home"));
  for (const candidate of candidates) {
    let resolved: string;
    try {
      resolved = realpathSync.native(candidate);
    } catch {
      continue;
    }
    const relative = path.relative(home, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    return resolved;
  }
  return null;
}

function authorizeIpc(event: IpcMainInvokeEvent, mainOnly = false): void {
  const frame = event.senderFrame;
  const appOrigin = frontendServer?.runtime.url;
  let frameOrigin: string | undefined;
  try {
    frameOrigin = frame ? new URL(frame.url).origin : undefined;
  } catch {}
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    !appOrigin ||
    frameOrigin !== new URL(appOrigin).origin ||
    (mainOnly && event.sender !== mainWindow?.webContents)
  ) {
    throw new Error("Unauthorized desktop IPC sender");
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-runtime", async (event) => {
    authorizeIpc(event);
    return {
      platform: process.platform,
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      releaseChannel: isDevChannelBuild ? "dev" : "stable",
      chromeVersion: process.versions.chrome,
      electronVersion: process.versions.electron,
    };
  });

  ipcMain.handle("desktop:reveal-path", async (event, target: IpcValue) => {
    authorizeIpc(event, true);
    const resolved = resolveHomeConfinedPath(target);
    if (!resolved) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  ipcMain.handle("desktop:open-path", async (event, target: IpcValue) => {
    authorizeIpc(event, true);
    const resolved = resolveHomeConfinedPath(target);
    if (!resolved) return false;
    const error = await shell.openPath(resolved);
    return error === "";
  });

  ipcMain.handle("desktop:get-update-status", async (event) => {
    authorizeIpc(event, true);
    return getUpdateState();
  });
  ipcMain.handle("desktop:start-update", async (event) => {
    authorizeIpc(event, true);
    return startUpdate();
  });
  ipcMain.handle("desktop:get-kittylitter-pairing-json", async (event) => {
    authorizeIpc(event, true);
    return getKittylitterPairingJson();
  });
  ipcMain.handle("desktop:copy-kittylitter-pairing-json", async (event, pairingJson: IpcValue) => {
    authorizeIpc(event, true);
    try {
      const value = stringValue(pairingJson);
      if (value === undefined) throw new Error("invalid pairing payload");
      clipboard.writeText(normalizeKittylitterPairingJson(value));
      return { ok: true };
    } catch {
      return { ok: false, error: "Connection JSON could not be copied." };
    }
  });

  ipcMain.handle("desktop:open-directory", async (event) => {
    authorizeIpc(event, true);
    const owner = mainWindow ?? undefined;
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    if (!selected) return null;
    try {
      return projects.addProject(selected);
    } catch (error) {
      log.error(`Failed to add project from dialog: ${String(error)}`);
      throw error;
    }
  });

  ipcMain.handle("desktop:controller-deploy", async (event, payload: IpcValue) => {
    authorizeIpc(event, true);
    const options = decodeControllerDeployOptions(payload);
    if (Option.isNone(options)) return { ok: false, error: "Invalid deploy options" };
    const resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, "app", "scripts")
      : path.join(app.getAppPath(), "..", "scripts");
    return deployController(options.value, resourcesPath, (line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("desktop:controller-deploy-log", { line });
      }
    });
  });

  ipcMain.handle("desktop:list-projects", async (event) => {
    authorizeIpc(event, true);
    return projects.listProjects();
  });

  ipcMain.handle("desktop:add-project", async (event, directoryPath: IpcValue) => {
    authorizeIpc(event, true);
    const value = stringValue(directoryPath);
    if (value === undefined) throw new Error("directoryPath must be a string");
    return projects.addProject(value);
  });

  ipcMain.handle("desktop:remove-project", async (event, id: IpcValue) => {
    authorizeIpc(event, true);
    const value = stringValue(id);
    if (value === undefined) throw new Error("id must be a string");
    projects.removeProject(value);
    return { ok: true } as const;
  });

  ipcMain.handle("desktop:load-session-prefs", async (event) => {
    authorizeIpc(event);
    return readPreferences("session-prefs");
  });

  ipcMain.handle("desktop:save-session-prefs", async (event, prefs: IpcValue) => {
    authorizeIpc(event);
    const decoded = decodeSessionPrefsOption(prefs);
    if (Option.isNone(decoded)) {
      throw new Error("prefs must be a plain object");
    }
    writePreferences("session-prefs", decoded.value);
  });

  ipcMain.handle("desktop:load-ui-preferences", async (event) => {
    authorizeIpc(event, true);
    return readPreferences("ui-preferences");
  });

  ipcMain.handle("desktop:save-ui-preferences", async (event, prefs: IpcValue) => {
    authorizeIpc(event, true);
    const decoded = decodeUiPreferencesOption(prefs);
    if (Option.isNone(decoded)) throw new Error("prefs must be bounded string preferences");
    writePreferences("ui-preferences", decoded.value);
  });

  ipcMain.handle("desktop:quick-panel-expand", async (event) => {
    authorizeIpc(event);
    resizeQuickPanelToThread();
  });

  ipcMain.handle("desktop:quick-panel-dismiss", async (event) => {
    authorizeIpc(event);
    dismissQuickPanel();
  });

  ipcMain.handle("desktop:quick-panel-get-hotkey", async (event) => {
    authorizeIpc(event, true);
    return {
      hotkey: quickPanelHotkey ?? getStoredQuickPanelHotkey() ?? DESKTOP_CONFIG.quickPanel.hotkey,
      defaultHotkey: DESKTOP_CONFIG.quickPanel.hotkey,
    };
  });

  ipcMain.handle("desktop:quick-panel-set-hotkey", async (event, hotkey: IpcValue) => {
    authorizeIpc(event, true);
    return setQuickPanelHotkey(hotkey);
  });

  ipcMain.handle(
    "desktop:focus-main-and-navigate",
    async (event, projectId: IpcValue, sessionId?: IpcValue) => {
      authorizeIpc(event);
      const project = stringValue(projectId);
      const session = stringValue(sessionId);
      if (project === undefined || !frontendServer) return;
      const query = session
        ? `?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`
        : `?project=${encodeURIComponent(project)}&new=1`;
      const targetUrl = `${frontendServer.runtime.url}/agent${query}`;
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(targetUrl);
      } else {
        openMainWindow(targetUrl);
      }
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.focus();
      dismissQuickPanel();
    },
  );
}

let quickPanelHotkey: string | null = null;

function onQuickPanelHotkey(): void {
  if (!frontendServer) return;
  toggleQuickPanel(frontendServer.runtime.url);
}

function tryRegisterQuickPanelHotkey(accelerator: string): boolean {
  try {
    return globalShortcut.register(accelerator, onQuickPanelHotkey);
  } catch {
    return false;
  }
}

function registerQuickPanelHotkey(): void {
  const accelerator = getStoredQuickPanelHotkey() ?? DESKTOP_CONFIG.quickPanel.hotkey;
  if (tryRegisterQuickPanelHotkey(accelerator)) {
    quickPanelHotkey = accelerator;
    return;
  }
  log.warn(`Failed to register quick panel hotkey: ${accelerator}`);
  const fallback = DESKTOP_CONFIG.quickPanel.hotkey;
  if (accelerator !== fallback && tryRegisterQuickPanelHotkey(fallback)) {
    quickPanelHotkey = fallback;
  }
}

function setQuickPanelHotkey(hotkey: IpcValue) {
  const current = quickPanelHotkey ?? DESKTOP_CONFIG.quickPanel.hotkey;
  const next = stringValue(hotkey)?.trim();
  if (!next) return { ok: false, hotkey: current, error: "Hotkey must be a non-empty string" };
  if (next === quickPanelHotkey) {
    setStoredQuickPanelHotkey(next);
    return { ok: true, hotkey: next };
  }

  if (!tryRegisterQuickPanelHotkey(next)) {
    return {
      ok: false,
      hotkey: current,
      error: `Could not register "${next}" — it may be invalid or already in use by another app`,
    };
  }

  if (quickPanelHotkey && quickPanelHotkey !== next) {
    try {
      globalShortcut.unregister(quickPanelHotkey);
    } catch {}
  }
  quickPanelHotkey = next;
  setStoredQuickPanelHotkey(next);
  log.info(`Quick panel hotkey set to ${next}`);
  return { ok: true, hotkey: next };
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    appState = "stopping";
    stopFrontendHealthMonitor();
    globalShortcut.unregisterAll();
    await stopFrontendServer(frontendServer);
    frontendServer = undefined;
  })();
  return shutdownPromise;
}

async function run(): Promise<void> {
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (appState === "stopping") {
      relaunchAfterShutdown = true;
      return;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow) {
      void bootstrap();
    }
  });

  app.on("before-quit", (event) => {
    if (quitAfterShutdown) return;
    event.preventDefault();
    void shutdown()
      .catch((error) => {
        log.error(`Shutdown failed: ${error instanceof Error ? error.stack : String(error)}`);
      })
      .finally(() => {
        if (relaunchAfterShutdown) app.relaunch();
        quitAfterShutdown = true;
        app.quit();
      });
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    void processMemorySummary().then((memory) => {
      log.error(
        [
          "App render-process-gone",
          `reason=${details.reason}`,
          `exitCode=${details.exitCode}`,
          `url=${webContents.getURL()}`,
          `appVersion=${app.getVersion()}`,
          memory,
        ].join(" "),
      );
    });
  });

  process.on("uncaughtException", (error) => {
    log.error(`Uncaught exception: ${error.stack ?? String(error)}`);
  });

  process.on("unhandledRejection", (error) => {
    log.error(`Unhandled rejection: ${String(error)}`);
  });

  registerIpcHandlers();
  registerNavigationPolicy();

  await app.whenReady();

  installApplicationMenu();
  initializeAutoUpdates();

  try {
    await bootstrap();
    registerQuickPanelHotkey();
  } catch (error) {
    log.error(`Failed to bootstrap desktop app: ${String(error)}`);
    try {
      dialog.showErrorBox(
        "Local Studio failed to start",
        `${error instanceof Error ? error.message : String(error)}\n\nSee the app logs for details.`,
      );
    } catch {}
    app.quit();
  }
}

void run();

const preferencesPath = (name: "session-prefs" | "ui-preferences") =>
  path.join(app.getPath("userData"), `${name}.json`);

function readPreferences(name: "session-prefs"): SessionPrefs;
function readPreferences(name: "ui-preferences"): UiPreferences;
function readPreferences(name: "session-prefs" | "ui-preferences"): SessionPrefs {
  const file = preferencesPath(name);
  try {
    if (!existsSync(file) || statSync(file).size > PREFERENCES_FILE_MAX_BYTES) return {};
    const value: Json = JSON.parse(readFileSync(file, "utf8"));
    return name === "session-prefs"
      ? Option.getOrElse(decodeSessionPrefsOption(value), () => ({}))
      : Option.getOrElse(decodeUiPreferencesOption(value), () => ({}));
  } catch {
    return {};
  }
}

const writePreferences = (name: "session-prefs" | "ui-preferences", value: SessionPrefs) =>
  writeJsonAtomic(preferencesPath(name), value);

import { app } from "electron";
import { isDevChannelBuild } from "../app-identity";
import { autoUpdater } from "electron-updater";
import { DESKTOP_CONFIG } from "../configs";
import type { DesktopUpdateSnapshot } from "../types";
import { log } from "../helpers/logger";
import { isLoopbackHttpUrl } from "../helpers/url";

let latestUpdateState: DesktopUpdateSnapshot = { status: "idle" };
let installRequested = false;

function setUpdateState(nextState: DesktopUpdateSnapshot): void {
  latestUpdateState = nextState;
}

type UpdateFailure = Parameters<StringConstructor>[0];
function setUpdateError(error: UpdateFailure): void {
  installRequested = false;
  const message = String(error);
  setUpdateState({ status: "error", message });
  log.error(`Auto update error: ${message}`);
}

function resolveFeedUrl(): string | null {
  const raw = process.env.LOCAL_STUDIO_UPDATE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && !isLoopbackHttpUrl(raw)) {
      log.warn(`[update] Ignoring non-https update feed: ${parsed.protocol}//${parsed.host}`);
      return null;
    }
  } catch {
    log.warn("[update] Ignoring malformed LOCAL_STUDIO_UPDATE_URL");
    return null;
  }
  return raw.replace(/\/+$/, "");
}

function ensureFeedConfigured(): string {
  const feedUrl = resolveFeedUrl();
  if (feedUrl) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: feedUrl,
      channel: "stable",
    });
    return feedUrl;
  }

  autoUpdater.setFeedURL({
    provider: "github",
    owner: "sybil-solutions",
    repo: "local-studio",
  });
  return "github:sybil-solutions/local-studio";
}

export function getUpdateState(): DesktopUpdateSnapshot {
  return latestUpdateState;
}

export async function checkForUpdates(force = false): Promise<DesktopUpdateSnapshot> {
  if (DESKTOP_CONFIG.disableAutoUpdate) {
    const disabledState = {
      status: "error",
      message: "Auto update disabled by LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE",
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(disabledState);
    return disabledState;
  }

  if (isDevChannelBuild && !resolveFeedUrl()) {
    const devChannelState = {
      status: "idle",
      message: "Dev-channel builds do not auto-update from stable releases",
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(devChannelState);
    return devChannelState;
  }

  ensureFeedConfigured();

  if (!app.isPackaged && !force) {
    const devState = {
      status: "idle",
      message: "Auto updates are only available in packaged builds",
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(devState);
    return devState;
  }

  try {
    setUpdateState({ status: "checking" });
    autoUpdater.allowPrerelease = false;
    const result = await autoUpdater.checkForUpdates();
    if (result?.downloadPromise) void result.downloadPromise.catch(setUpdateError);
    if (!result && latestUpdateState.status === "checking") {
      setUpdateState({ status: "idle", message: "Updater unavailable in this build" });
    }
    return latestUpdateState;
  } catch (error) {
    const errorState = {
      status: "error",
      message: String(error),
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(errorState);
    return errorState;
  }
}

export async function startUpdate(): Promise<DesktopUpdateSnapshot> {
  installRequested = true;
  if (latestUpdateState.status === "downloaded") {
    installRequested = false;
    autoUpdater.quitAndInstall();
    return latestUpdateState;
  }
  if (["checking", "available", "downloading"].includes(latestUpdateState.status)) {
    return latestUpdateState;
  }
  const snapshot = await checkForUpdates(true);
  if (
    snapshot.status === "idle" ||
    snapshot.status === "not-available" ||
    snapshot.status === "error"
  ) {
    installRequested = false;
  }
  return snapshot;
}

export function initializeAutoUpdates(): void {
  if (DESKTOP_CONFIG.disableAutoUpdate) {
    log.warn("Auto update disabled by environment flag");
    return;
  }

  if (isDevChannelBuild && !resolveFeedUrl()) {
    setUpdateState({ status: "idle", message: "Dev channel: auto-update disabled" });
    log.info("[update] Dev-channel build; skipping stable release feed");
    return;
  }

  log.info(`[update] Feed: ${ensureFeedConfigured()}`);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({ status: "checking" });
    log.info("Checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({ status: "available", version: info.version });
    log.info(`Update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", (info) => {
    installRequested = false;
    setUpdateState({ status: "not-available", version: info.version });
    log.info("No update available");
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      version: latestUpdateState.version,
      message: `${progress.percent.toFixed(1)}%`,
      progress: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ status: "downloaded", version: info.version });
    log.info(`Update downloaded: ${info.version}`);
    if (installRequested) {
      installRequested = false;
      log.info(`Restarting to install update: ${info.version}`);
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (error) => {
    setUpdateError(error);
  });

  if (app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates().catch((error) => {
        log.error(`Background update check failed: ${String(error)}`);
      });
    }, 4_000);
  }
}

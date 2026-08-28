import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

const ZOOM_STEPS: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

export function clampZoomFactor(factor: number): number {
  let nearest: number = ZOOM_STEPS[0];
  for (const step of ZOOM_STEPS) {
    if (Math.abs(step - factor) < Math.abs(nearest - factor)) nearest = step;
  }
  return nearest;
}

function stepZoom(direction: 1 | -1): void {
  const contents = BrowserWindow.getFocusedWindow()?.webContents;
  if (!contents) return;
  const index = ZOOM_STEPS.indexOf(clampZoomFactor(contents.getZoomFactor()));
  const next = ZOOM_STEPS[Math.min(Math.max(index + direction, 0), ZOOM_STEPS.length - 1)];
  contents.setZoomFactor(next);
}

function resetZoom(): void {
  BrowserWindow.getFocusedWindow()?.webContents.setZoomFactor(1);
}

export function installApplicationMenu(): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: resetZoom },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => stepZoom(1) },
        {
          label: "Zoom In (=)",
          accelerator: "CmdOrCtrl+=",
          click: () => stepZoom(1),
          visible: false,
        },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => stepZoom(-1) },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: `${app.getName()} ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];
  if (isMac) template.unshift({ role: "appMenu" });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function clampWindowZoom(window: BrowserWindow): void {
  window.webContents.on("did-finish-load", () => {
    const contents = window.webContents;
    const clamped = clampZoomFactor(contents.getZoomFactor());
    if (clamped !== contents.getZoomFactor()) contents.setZoomFactor(clamped);
  });
}

type ElectronWindow = {
  focus(): void;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
};

type ElectronApp = {
  on(event: "second-instance", listener: () => void): void;
  quit(): void;
  requestSingleInstanceLock(): boolean;
};

export function acquireSingleInstanceLock(
  app: ElectronApp,
  getMainWindow: () => ElectronWindow | null
) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on("second-instance", () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  });

  return true;
}

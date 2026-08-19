export function shouldEnableDesktopUpdates({
  isPackaged,
  portableExecutableDir,
  updateConfigPresent
}: {
  isPackaged: boolean;
  portableExecutableDir?: string | null;
  updateConfigPresent: boolean;
}) {
  return isPackaged && !String(portableExecutableDir ?? "").trim() && updateConfigPresent;
}

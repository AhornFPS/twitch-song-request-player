export function shouldEnableDesktopUpdates({
  isPackaged,
  portableExecutableDir
}: {
  isPackaged: boolean;
  portableExecutableDir?: string | null;
}) {
  return isPackaged && !String(portableExecutableDir ?? "").trim();
}

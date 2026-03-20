import path from "node:path";

export function resolveAppRootFromModuleDir(moduleDir: string) {
  const normalizedModuleDir = path.resolve(moduleDir);
  const moduleBaseName = path.basename(normalizedModuleDir).toLowerCase();
  const parentDir = path.dirname(normalizedModuleDir);
  const parentBaseName = path.basename(parentDir).toLowerCase();

  if (parentBaseName === "build" && ["src", "electron"].includes(moduleBaseName)) {
    return path.resolve(normalizedModuleDir, "..", "..");
  }

  if (["build", "src", "electron"].includes(moduleBaseName)) {
    return path.resolve(normalizedModuleDir, "..");
  }

  return normalizedModuleDir;
}

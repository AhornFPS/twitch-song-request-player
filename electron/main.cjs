const electron = require("electron");

(async () => {
  const { bootstrapDesktopApp } = await import("./bootstrap.js");
  await bootstrapDesktopApp(electron);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

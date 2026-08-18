import assert from "node:assert/strict";
import test from "node:test";
import { createSettingsCoordinator } from "./settings-store-coordinator.js";

test("concurrent partial settings saves are serialized without losing either change", async () => {
  let persistedSettings = {
    theme: "aurora",
    guiPlayerVolume: 100
  };
  const configStore = {
    async saveSettings(settings) {
      if (settings.theme === "sunset" && settings.guiPlayerVolume === 100) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      persistedSettings = { ...settings };
      return persistedSettings;
    }
  };
  const coordinator = createSettingsCoordinator(configStore, persistedSettings);

  const firstSave = coordinator.update({ theme: "sunset" });
  const secondSave = coordinator.update({ guiPlayerVolume: 37 });
  await Promise.all([firstSave, secondSave]);

  assert.equal(persistedSettings.theme, "sunset");
  assert.equal(persistedSettings.guiPlayerVolume, 37);
  assert.deepEqual(coordinator.getCurrentSettings(), persistedSettings);
});

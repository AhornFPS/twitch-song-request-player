type SettingsRecord = Record<string, unknown>;

type SettingsStore = {
  saveSettings(settings: SettingsRecord): Promise<SettingsRecord>;
};

export function createSettingsCoordinator(
  configStore: SettingsStore,
  initialSettings: SettingsRecord
) {
  let currentSettings = initialSettings;
  let saveTail: Promise<unknown> = Promise.resolve();

  return {
    getCurrentSettings() {
      return currentSettings;
    },
    update(partialSettings: SettingsRecord = {}) {
      const save = saveTail.then(async () => {
        const previousSettings = currentSettings;
        const nextSettings = await configStore.saveSettings({
          ...currentSettings,
          ...partialSettings
        });
        currentSettings = nextSettings;
        return {
          previousSettings,
          nextSettings
        };
      });
      saveTail = save.then(() => undefined, () => undefined);
      return save;
    }
  };
}

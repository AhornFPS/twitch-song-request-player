const commandSpecs = [
  {
    id: "song_request",
    label: "Song request",
    description: "Queue a YouTube or SoundCloud track from chat.",
    trigger: "!sr",
    aliases: [],
    permission: "everyone",
    enabled: true
  },
  {
    id: "current_song",
    label: "Current song",
    description: "Show the track that is playing right now.",
    trigger: "!currentsong",
    aliases: [],
    permission: "everyone",
    enabled: true
  },
  {
    id: "skip_current",
    label: "Skip current",
    description: "Skip the active track.",
    trigger: "!skip",
    aliases: [],
    permission: "vip",
    enabled: true
  },
  {
    id: "delete_current",
    label: "Delete current",
    description: "Delete the active track from the fallback playlist.",
    trigger: "!delete",
    aliases: [],
    permission: "vip",
    enabled: true
  },
  {
    id: "save_current",
    label: "Save current",
    description: "Save the active track to the fallback playlist.",
    trigger: "!save",
    aliases: [],
    permission: "vip",
    enabled: true
  },
  {
    id: "open_requests",
    label: "Open requests",
    description: "Re-open viewer song requests.",
    trigger: "!sropen",
    aliases: [],
    permission: "moderator",
    enabled: true
  },
  {
    id: "close_requests",
    label: "Close requests",
    description: "Close viewer song requests.",
    trigger: "!srclose",
    aliases: [],
    permission: "moderator",
    enabled: true
  }
];

const validPermissions = new Set([
  "everyone",
  "vip",
  "moderator",
  "broadcaster"
]);

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalizedValue)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalizedValue)) {
      return false;
    }
  }

  return fallback;
}

function normalizeTrigger(value, fallback = "") {
  const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  const candidate = normalizedValue || fallback;

  if (!candidate) {
    return "";
  }

  return candidate.startsWith("!") ? candidate : `!${candidate}`;
}

function normalizeAliases(value) {
  const aliases = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      aliases
        .map((alias) => normalizeTrigger(alias))
        .filter(Boolean)
    )
  );
}

function normalizePermission(value, fallback) {
  const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  return validPermissions.has(normalizedValue) ? normalizedValue : fallback;
}

export function getChatCommandSpecs() {
  return commandSpecs.map((spec) => ({
    ...spec,
    aliases: [...spec.aliases]
  }));
}

export function getDefaultChatCommands() {
  return Object.fromEntries(
    commandSpecs.map((spec) => [
      spec.id,
      {
        id: spec.id,
        label: spec.label,
        description: spec.description,
        enabled: spec.enabled,
        trigger: spec.trigger,
        aliases: [...spec.aliases],
        permission: spec.permission
      }
    ])
  );
}

export function normalizeChatCommands(rawChatCommands = {}) {
  const defaults = getDefaultChatCommands();

  return Object.fromEntries(
    commandSpecs.map((spec) => {
      const rawCommand = rawChatCommands?.[spec.id] ?? {};
      const trigger = normalizeTrigger(rawCommand.trigger, spec.trigger);
      const aliases = normalizeAliases(rawCommand.aliases).filter((alias) => alias !== trigger);

      return [
        spec.id,
        {
          id: spec.id,
          label: spec.label,
          description: spec.description,
          enabled: normalizeBoolean(rawCommand.enabled, spec.enabled),
          trigger: trigger || defaults[spec.id].trigger,
          aliases,
          permission: normalizePermission(rawCommand.permission, spec.permission)
        }
      ];
    })
  );
}

export function validateChatCommands(chatCommands) {
  const issues = [];
  const claimedTriggers = new Map();

  for (const spec of commandSpecs) {
    const command = chatCommands?.[spec.id];

    if (!command) {
      issues.push(`Missing command configuration for ${spec.label}.`);
      continue;
    }

    if (!command.enabled) {
      continue;
    }

    if (!command.trigger) {
      issues.push(`${spec.label} needs a trigger.`);
      continue;
    }

    const triggers = [command.trigger, ...(command.aliases ?? [])];
    for (const trigger of triggers) {
      if (!trigger) {
        continue;
      }

      const owner = claimedTriggers.get(trigger);
      if (owner && owner !== spec.id) {
        issues.push(`The trigger ${trigger} is assigned to more than one chat command.`);
        continue;
      }

      claimedTriggers.set(trigger, spec.id);
    }
  }

  return issues;
}

export function findChatCommandAction(message, chatCommands) {
  const [firstWord] = String(message ?? "").trim().toLowerCase().split(/\s+/);

  if (!firstWord) {
    return null;
  }

  for (const spec of commandSpecs) {
    const command = chatCommands?.[spec.id];
    if (!command?.enabled) {
      continue;
    }

    const triggers = [command.trigger, ...(command.aliases ?? [])];
    if (triggers.includes(firstWord)) {
      return spec.id;
    }
  }

  return null;
}

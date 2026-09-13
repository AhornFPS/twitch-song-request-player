// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RequestAuditStore } from "./request-audit-store.js";

async function withAuditStore(run) {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "request-audit-store-"));
  const auditPath = path.join(runtimeDir, "request-log.json");

  try {
    await run({
      auditPath,
      backupPath: `${auditPath}.backup`,
      store: new RequestAuditStore(auditPath)
    });
  } finally {
    await fs.rm(runtimeDir, { recursive: true, force: true });
  }
}

function createAuditState(title) {
  return {
    events: [{
      id: `event-${title}`,
      createdAt: "2026-09-03T12:00:00.000Z",
      source: "twitch",
      outcome: "accepted",
      requester: {
        username: "listener",
        displayName: "Listener"
      },
      track: {
        provider: "youtube",
        url: "https://example.invalid/watch",
        title,
        key: `youtube:${title}`
      }
    }],
    requesterStats: {}
  };
}

test("request audit saves matching atomic primary and backup snapshots", async () => {
  await withAuditStore(async ({ auditPath, backupPath, store }) => {
    await store.save(createAuditState("Crash Safe"));

    const primary = JSON.parse(await fs.readFile(auditPath, "utf8"));
    const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
    assert.deepEqual(primary, backup);
    assert.equal(primary.events[0].track.title, "Crash Safe");

    const leftovers = (await fs.readdir(path.dirname(auditPath)))
      .filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});

test("request audit recovers from a truncated primary using its valid backup", async () => {
  await withAuditStore(async ({ auditPath, store }) => {
    await store.save(createAuditState("Recovered Request"));
    await fs.writeFile(auditPath, '{"events":[{"track":{"title":"cut off', "utf8");

    const restored = await store.load();
    assert.equal(restored.events.length, 1);
    assert.equal(restored.events[0].track.title, "Recovered Request");
  });
});

test("request audit corruption never blocks startup when no valid snapshot remains", async () => {
  await withAuditStore(async ({ auditPath, backupPath, store }) => {
    await fs.writeFile(auditPath, '{"events":["unterminated', "utf8");
    await fs.writeFile(backupPath, '{"requesterStats":', "utf8");

    assert.deepEqual(await store.load(), {
      events: [],
      requesterStats: {}
    });
  });
});

test("request audit serializes overlapping saves in invocation order", async () => {
  await withAuditStore(async ({ auditPath, backupPath, store }) => {
    await Promise.all([
      store.save(createAuditState("First")),
      store.save(createAuditState("Second")),
      store.save(createAuditState("Final"))
    ]);

    const primary = JSON.parse(await fs.readFile(auditPath, "utf8"));
    const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
    assert.equal(primary.events[0].track.title, "Final");
    assert.deepEqual(primary, backup);
  });
});

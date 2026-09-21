import test from "node:test";
import assert from "node:assert/strict";

import { RoomManager } from "../src/server/room-manager.js";

void test("room operations for one room execute serially", async () => {
  const manager = new RoomManager();
  const events: string[] = [];

  await Promise.all([
    manager.runExclusive("ABC123", async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => setImmediate(resolve));
      events.push("first:end");
    }),
    manager.runExclusive("ABC123", async () => {
      events.push("second:start");
      events.push("second:end");
      await Promise.resolve();
    }),
  ]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
  await manager.closeAll();
});

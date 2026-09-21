import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

test("bundled local worker runs and requests a curtain on seat changes", async (t) => {
  const moduleURL = new URL("../public/riichi-worker.js", import.meta.url).href;
  const worker = new Worker(
    `const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(moduleURL)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({type:'ready'});});`,
    { eval: true },
  );
  t.after(() => worker.terminate());
  const queue = [],
    pending = [];
  worker.on("message", (m) => {
    if (pending.length) pending.shift()(m);
    else queue.push(m);
  });
  async function until(predicate) {
    for (let i = 0; i < 40; i++) {
      const m = queue.length
        ? queue.shift()
        : await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(Error("worker response timed out")),
              4000,
            );
            pending.push((m) => {
              clearTimeout(timeout);
              resolve(m);
            });
          });
      if (m.type === "error") throw Error(m.message);
      if (predicate(m)) return m;
    }
    throw Error("worker did not reach expected state");
  }
  await until((m) => m.type === "ready");
  worker.postMessage({ type: "start", mode: "local", rounds: 0 });
  const east = await until((m) =>
    m.state?.choices.some((c) => c.kind === "discard"),
  );
  assert.equal(east.handoff, 0);
  assert.equal(east.state.hand.length, 14);
  worker.postMessage({ type: "ready" });
  const visible = await until(
    (m) => m.state?.choices.length && m.handoff === null,
  );
  assert.equal(visible.state.seat, 0);
  worker.postMessage({
    type: "action",
    id: visible.state.choices.find((c) => c.kind === "discard").id,
  });
  const next = await until(
    (m) => m.handoff !== null && m.state?.seat !== 0 && m.state?.choices.length,
  );
  assert.equal(next.handoff, next.state.seat);
  assert(next.state.seat >= 1 && next.state.seat <= 3);
});

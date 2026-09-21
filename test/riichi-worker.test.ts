import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

interface Choice {
  readonly id: string;
  readonly kind: string;
}

interface WorkerState {
  readonly choices?: Choice[];
  readonly hand?: string[];
  readonly seat?: number;
}

interface WorkerMessage {
  readonly type: string;
  readonly message?: string;
  readonly state?: WorkerState;
  readonly handoff?: number | null;
}

const register = (
  name: string,
  callback: (context: TestContext) => Promise<void>,
): void => {
  void test(name, callback);
};

register(
  "bundled local worker runs and requests a curtain on seat changes",
  async (t) => {
    const moduleURL = new URL("../public/riichi-worker.js", import.meta.url)
      .href;
    const worker = new Worker(
      `const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(moduleURL)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({type:'ready'});});`,
      { eval: true },
    );
    t.after(() => {
      void worker.terminate();
    });
    const queue: WorkerMessage[] = [];
    const pending: Array<(message: WorkerMessage) => void> = [];
    worker.on("message", (value: unknown) => {
      const message = value as WorkerMessage;
      const resolve = pending.shift();
      if (resolve) resolve(message);
      else queue.push(message);
    });
    async function until(
      predicate: (message: WorkerMessage) => boolean,
    ): Promise<WorkerMessage> {
      for (let i = 0; i < 40; i++) {
        const m = queue.length
          ? queue.shift()
          : await new Promise<WorkerMessage>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(Error("worker response timed out"));
              }, 4000);
              pending.push((message) => {
                clearTimeout(timeout);
                resolve(message);
              });
            });
        if (!m) throw Error("worker response queue was empty");
        if (m.type === "error") throw Error(m.message ?? "worker failed");
        if (predicate(m)) return m;
      }
      throw Error("worker did not reach expected state");
    }
    await until((m) => m.type === "ready");
    worker.postMessage({ type: "start", mode: "local", rounds: 0 });
    const east = await until(
      (m) => m.state?.choices?.some((c) => c.kind === "discard") ?? false,
    );
    assert.ok(east.state);
    assert.ok(east.state.choices);
    assert.ok(east.state.hand);
    assert.equal(east.handoff, 0);
    assert.equal(east.state.hand.length, 14);
    worker.postMessage({ type: "ready" });
    const visible = await until((m) =>
      Boolean(m.state?.choices?.length && m.handoff === null),
    );
    assert.ok(visible.state);
    assert.ok(visible.state.choices);
    assert.equal(visible.state.seat, 0);
    const discard = visible.state.choices.find((c) => c.kind === "discard");
    assert.ok(discard);
    worker.postMessage({
      type: "action",
      id: discard.id,
    });
    const next = await until(
      (m) =>
        m.handoff !== null &&
        m.state?.seat !== 0 &&
        Boolean(m.state?.choices?.length),
    );
    assert.ok(next.state);
    assert.ok(next.state.seat);
    assert.equal(next.handoff, next.state.seat);
    assert(next.state.seat >= 1 && next.state.seat <= 3);
  },
);

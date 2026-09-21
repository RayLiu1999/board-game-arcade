import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createServer } from "../src/server/server.ts";

async function client(url) {
  const ws = new WebSocket(url),
    queue = [],
    pending = [];
  ws.on("message", (data) => {
    const m = JSON.parse(data);
    if (pending.length) pending.shift()(m);
    else queue.push(m);
  });
  await once(ws, "open");
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    async next(type) {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const m = queue.length
          ? queue.shift()
          : await new Promise((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(Error("Missing " + type)),
                2500,
              );
              pending.push((value) => {
                clearTimeout(timeout);
                resolve(value);
              });
            });
        if (m.type === type) return m;
      }
      throw Error("Missing " + type);
    },
  };
}

test("authoritative multiplayer rooms", async (t) => {
  const { server, wss } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  const a = await client(url),
    b = await client(url),
    c = await client(url);
  a.send({ type: "create", game: "gomoku", name: "甲" });
  const joined = await a.next("joined");
  assert.match(joined.code, /^[A-F0-9]{6}$/);
  assert.equal(joined.side, 1);
  await a.next("state");
  await t.test("cannot move before an opponent joins", async () => {
    a.send({ type: "move", ply: 0, move: { to: 112 } });
    assert.match((await a.next("error")).message, /等待/);
  });
  b.send({ type: "join", code: joined.code, name: "乙" });
  const bJoined = await b.next("joined");
  assert.equal(bJoined.side, -1);
  await a.next("state");
  await b.next("state");
  await t.test("rejects full rooms and out-of-turn moves", async () => {
    c.send({ type: "join", code: joined.code });
    assert.match((await c.next("error")).message, /已滿/);
    b.send({ type: "move", ply: 0, move: { to: 112 } });
    assert.match((await b.next("error")).message, /輪到/);
  });
  await t.test("both players receive the same server state", async () => {
    a.send({ type: "move", ply: 0, move: { to: 112 } });
    const sa = await a.next("state"),
      sb = await b.next("state");
    assert.deepEqual(sa.state, sb.state);
    assert.equal(sa.state.board[112], 1);
    assert.equal(sa.state.turn, -1);
  });
  await t.test("rejects stale state and occupied squares", async () => {
    b.send({ type: "move", ply: 0, move: { to: 113 } });
    assert.match((await b.next("error")).message, /更新/);
    b.send({ type: "move", ply: 1, move: { to: 112 } });
    assert.match((await b.next("error")).message, /規則/);
  });
  await t.test(
    "a disconnected player resumes the same seat with a token",
    async () => {
      b.ws.close();
      await once(b.ws, "close");
      const offline = await a.next("state");
      assert.equal(offline.players[1].online, false);
      c.send({ type: "join", code: joined.code, token: bJoined.token });
      assert.equal((await c.next("joined")).side, -1);
      const restored = await c.next("state");
      await a.next("state");
      assert.equal(restored.state.ply, 1);
      assert.equal(restored.players[1].name, "乙");
    },
  );
  await t.test("resignation and rematch require both players", async () => {
    c.send({ type: "resign" });
    assert.equal((await a.next("state")).state.winner, 1);
    await c.next("state");
    a.send({ type: "rematch" });
    assert.equal((await a.next("state")).state.winner, 1);
    await c.next("state");
    c.send({ type: "rematch" });
    assert.equal((await a.next("state")).state.ply, 0);
    assert.equal((await c.next("state")).state.winner, null);
  });
  await t.test("malformed messages do not terminate the server", async () => {
    a.ws.send("{invalid");
    assert.equal((await a.next("error")).type, "error");
    a.send({ type: "move", ply: 0, move: { to: 112 } });
    assert.equal((await a.next("state")).state.ply, 1);
    await c.next("state");
  });
  await t.test("HTTP serves app and rejects private files", async () => {
    const base = url.replace("ws:", "http:");
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /棋聚/);
    assert.equal((await fetch(base + "/server.js")).status, 404);
    assert.equal((await fetch(base + "/..%2fpackage.json")).status, 404);
  });
});

test("riichi supports four private seats, pauses, and reconnects", async (t) => {
  const { server, wss, rooms } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const room of rooms.values()) room.session?.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  const clients = await Promise.all([0, 1, 2, 3].map(() => client(url))),
    tokens = [];
  clients[0].send({
    type: "create",
    game: "riichi",
    rounds: 0,
    name: "東玩家",
  });
  const host = await clients[0].next("joined");
  tokens.push(host.token);
  const waiting = await clients[0].next("state");
  assert.equal(waiting.players.length, 4);
  assert.equal(waiting.state.phase, "waiting");
  for (let id = 1; id < 4; id++) {
    clients[id].send({ type: "join", code: host.code, name: `玩家${id}` });
    const joined = await clients[id].next("joined");
    tokens.push(joined.token);
    assert.equal(joined.side, id + 1);
  }
  async function until(c, predicate) {
    for (let n = 0; n < 30; n++) {
      const m = await c.next("state");
      if (predicate(m)) return m;
    }
    throw Error("No expected state");
  }
  const views = await Promise.all(
    clients.map((c) =>
      until(c, (m) => m.state.hand?.length >= 13 && m.state.ply >= 3),
    ),
  );
  for (let id = 0; id < 4; id++) {
    assert.equal(views[id].state.seat, id);
    assert.equal(views[id].state.hand.length, id === 0 ? 14 : 13);
    assert.equal(views[id].state.seats[0].hand, undefined);
    assert.equal(views[id].state.seats[0].shoupai, undefined);
  }
  const action = views[0].state.choices.find((c) => c.kind === "discard");
  clients[1].send({ type: "riichi-action", actionId: action.id });
  assert.match((await clients[1].next("error")).message, /座位/);
  clients[2].ws.close();
  await once(clients[2].ws, "close");
  await until(clients[0], (m) => m.players[2].online === false);
  assert.equal(rooms.get(host.code).session.paused, true);
  clients[0].send({ type: "riichi-action", actionId: action.id });
  assert.match((await clients[0].next("error")).message, /等待/);
  const back = await client(url);
  back.send({ type: "join", code: host.code, token: tokens[2] });
  assert.equal((await back.next("joined")).side, 3);
  const restored = await back.next("state");
  assert.equal(restored.state.seat, 2);
  assert.equal(restored.state.hand.length, 13);
  assert.equal(rooms.get(host.code).session.paused, false);
  clients[0].send({ type: "riichi-action", actionId: action.id });
  await until(clients[0], (m) => m.state.seats?.[0].river.length === 1);
});

test("riichi host can fill empty seats with AI; bot seats cannot be stolen", async (t) => {
  const { server, wss, rooms } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const room of rooms.values()) room.session?.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  const a = await client(url),
    b = await client(url),
    intruder = await client(url);
  a.send({ type: "create", game: "riichi", rounds: 0 });
  const joined = await a.next("joined");
  await a.next("state");
  b.send({ type: "join", code: joined.code });
  await b.next("joined");
  await b.next("state");
  b.send({ type: "riichi-start" });
  assert.match((await b.next("error")).message, /房主/);
  a.send({ type: "riichi-start" });
  let started;
  for (let n = 0; n < 10; n++) {
    const m = await a.next("state");
    if (m.state.hand?.length === 14) {
      started = m;
      break;
    }
  }
  assert(started);
  assert.equal(started.players.filter((p) => p.bot).length, 2);
  assert.equal(started.players.filter((p) => p.online).length, 4);
  intruder.send({ type: "join", code: joined.code });
  assert.match((await intruder.next("error")).message, /已滿/);
});

test("shogi works through the existing authoritative room protocol", async (t) => {
  const { server, wss } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  const a = await client(url),
    b = await client(url);
  a.send({ type: "create", game: "shogi" });
  const joined = await a.next("joined");
  await a.next("state");
  b.send({ type: "join", code: joined.code });
  await b.next("joined");
  await a.next("state");
  await b.next("state");
  a.send({ type: "move", ply: 0, move: { from: 56, to: 47 } });
  const sa = await a.next("state"),
    sb = await b.next("state");
  assert.deepEqual(sa.state, sb.state);
  assert.equal(sa.state.board[47], 1);
  assert.equal(sa.state.turn, -1);
});

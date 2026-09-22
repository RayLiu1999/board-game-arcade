import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Pool } from "pg";
import { WebSocket, type RawData } from "ws";

import { PostgresProductStore } from "../src/server/postgres-product-store.js";
import { createServer } from "../src/server/server.js";
import { PostgresRoomStore } from "../src/server/postgres-room-store.js";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "../src/server/product-security.js";
import { CHAT_RATE_LIMIT_COUNT } from "../src/shared/protocol.js";
import type { ChatMessage, RoomMode } from "../src/shared/protocol.js";
import type {
  GameState,
  NumericBoardState,
  ShogiState,
} from "../src/shared/game-types.js";
import type { RiichiView } from "../lib/riichi-session.js";

interface WirePlayer {
  readonly name: string;
  readonly online: boolean;
  readonly bot?: boolean;
}

interface JoinedMessage {
  readonly type: "joined";
  readonly code: string;
  readonly token: string;
  readonly side: number;
  readonly mode: RoomMode;
}

interface ErrorMessage {
  readonly type: "error";
  readonly message: string;
}

interface StateMessage {
  readonly type: "state";
  readonly code: string;
  readonly side: number;
  readonly mode: RoomMode;
  readonly state: GameState | RiichiView;
  readonly players: Array<WirePlayer | null>;
  readonly rematch: number[];
  readonly chat: ChatMessage[];
}

interface ChatMessageEvent {
  readonly type: "chat";
  readonly message: ChatMessage;
}

interface MatchmakingMessage {
  readonly type: "matchmaking";
  readonly status: "waiting" | "matched" | "cancelled" | "expired";
  readonly ticket: string;
  readonly game: string;
  readonly mode: "casual" | "rated";
  readonly timeControl: "unlimited";
  readonly expiresAt?: number;
}

interface LeftMessage {
  readonly type: "left";
}

type ServerMessage =
  | JoinedMessage
  | ErrorMessage
  | StateMessage
  | ChatMessageEvent
  | MatchmakingMessage
  | LeftMessage;
type ServerMessageType = ServerMessage["type"];
type MessageOf<Type extends ServerMessageType> = Extract<
  ServerMessage,
  { readonly type: Type }
>;
type ServerBundle = ReturnType<typeof createServer>;

interface TestClient {
  readonly ws: WebSocket;
  send(message: Record<string, unknown>): void;
  next<Type extends ServerMessageType>(type: Type): Promise<MessageOf<Type>>;
}

const item = <Value>(values: readonly Value[], index: number): Value => {
  const value = values[index];
  if (value === undefined)
    throw new Error(`缺少索引 ${String(index)} 的測試資料`);
  return value;
};

const portOf = (server: ServerBundle["server"]): number => {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("伺服器尚未監聽");
  return address.port;
};

const closeServer = (server: ServerBundle["server"]): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const roomAt = (rooms: ServerBundle["rooms"], code: string) => {
  const room = rooms.get(code);
  if (!room) throw new Error(`找不到測試房間 ${code}`);
  return room;
};

const isRiichiView = (state: GameState | RiichiView): state is RiichiView =>
  state.game === "riichi" && state.phase !== "waiting";

const riichiView = (state: GameState | RiichiView): RiichiView => {
  if (!isRiichiView(state)) throw new Error("測試狀態不是進行中的日麻視圖");
  return state;
};

const numericState = (state: GameState | RiichiView): NumericBoardState => {
  if (
    state.game === "riichi" ||
    state.game === "chess" ||
    state.game === "shogi"
  )
    throw new Error("測試狀態不是數字棋盤");
  return state;
};

const shogiState = (state: GameState | RiichiView): ShogiState => {
  if (state.game !== "shogi") throw new Error("測試狀態不是將棋");
  return state;
};

const rawText = (data: RawData): string => {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer)
    return Buffer.from(new Uint8Array(data)).toString("utf8");
  return data.toString("utf8");
};

async function client(url: string, sessionToken?: string): Promise<TestClient> {
  const ws = new WebSocket(url, {
    ...(sessionToken === undefined
      ? {}
      : { headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` } }),
  });
  const queue: ServerMessage[] = [];
  const pending: Array<(message: ServerMessage) => void> = [];
  ws.on("message", (data) => {
    const message = JSON.parse(rawText(data)) as ServerMessage;
    const resolve = pending.shift();
    if (resolve) resolve(message);
    else queue.push(message);
  });
  await once(ws, "open");
  const nextMessage = async (): Promise<ServerMessage> => {
    const queued = queue.shift();
    if (queued) return queued;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("等待測試訊息逾時"));
      }, 2500);
      pending.push((value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
  };
  return {
    ws,
    send(message) {
      ws.send(JSON.stringify(message));
    },
    async next<Type extends ServerMessageType>(
      type: Type,
    ): Promise<MessageOf<Type>> {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const message = await nextMessage();
        if (message.type === type) return message as MessageOf<Type>;
      }
      throw new Error(`Missing ${type}`);
    },
  };
}

void test("authoritative multiplayer rooms", async (t) => {
  const { server, wss, productStore, rooms } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${String(portOf(server))}`;
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await closeServer(server);
  });
  const a = await client(url);
  const b = await client(url);
  const c = await client(url);
  a.send({ type: "create", game: "gomoku", name: "甲" });
  const joined = await a.next("joined");
  assert.match(joined.code, /^[A-F0-9]{6}$/);
  assert.equal(joined.side, 1);
  const matchId = roomAt(rooms, joined.code).matchId;
  assert.ok(matchId);
  const createdMatch = await productStore.getMatch(matchId);
  assert.ok(createdMatch);
  assert.equal(createdMatch.status, "active");
  assert.equal(createdMatch.participants[0]?.displayName, "甲");
  await a.next("state");
  await t.test("cannot move before an opponent joins", async () => {
    a.send({ type: "move", ply: 0, move: { to: 112 } });
    assert.match((await a.next("error")).message, /等待/);
  });
  await t.test("cannot chat before joining a room", async () => {
    c.send({ type: "chat", text: "不應該送出" });
    assert.match((await c.next("error")).message, /尚未加入/);
  });
  b.send({ type: "join", code: joined.code, name: "乙" });
  const bJoined = await b.next("joined");
  assert.equal(bJoined.side, -1);
  await a.next("state");
  await b.next("state");
  await t.test(
    "players can exchange text and emoji without creating game events",
    async () => {
      a.send({ type: "chat", text: "你好 🀄" });
      const fromA = await a.next("chat");
      const fromB = await b.next("chat");
      assert.deepEqual(fromA.message, fromB.message);
      assert.equal(fromA.message.matchId, matchId);
      assert.equal(fromA.message.name, "甲");
      assert.equal(fromA.message.side, 1);
      assert.equal(fromA.message.text, "你好 🀄");
      assert.equal(roomAt(rooms, joined.code).chat.length, 1);
      assert.equal((await productStore.listMatchEvents(matchId)).length, 0);
    },
  );
  await t.test("chat rate limit rejects bursts", async () => {
    for (let index = 1; index < CHAT_RATE_LIMIT_COUNT; index++) {
      a.send({ type: "chat", text: `訊息 ${String(index)}` });
      await a.next("chat");
      await b.next("chat");
    }
    a.send({ type: "chat", text: "太快了" });
    assert.match((await a.next("error")).message, /頻繁/);
  });
  await t.test("rejects full rooms and out-of-turn moves", async () => {
    c.send({ type: "join", code: joined.code });
    assert.match((await c.next("error")).message, /已滿/);
    b.send({ type: "move", ply: 0, move: { to: 112 } });
    assert.match((await b.next("error")).message, /輪到/);
  });
  await t.test("both players receive the same server state", async () => {
    a.send({ type: "move", ply: 0, move: { to: 112 } });
    const sa = await a.next("state");
    const sb = await b.next("state");
    assert.deepEqual(sa.state, sb.state);
    const board = numericState(sa.state);
    assert.equal(board.board[112], 1);
    assert.equal(board.turn, -1);
    const events = await productStore.listMatchEvents(matchId);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "board.move");
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
      const offlinePlayer = item(offline.players, 1);
      assert.ok(offlinePlayer);
      assert.equal(offlinePlayer.online, false);
      c.send({ type: "join", code: joined.code, token: bJoined.token });
      assert.equal((await c.next("joined")).side, -1);
      const restored = await c.next("state");
      await a.next("state");
      assert.equal(restored.state.ply, 1);
      assert.equal(item(restored.players, 1)?.name, "乙");
      assert.equal(restored.chat.length, CHAT_RATE_LIMIT_COUNT);
      assert.equal(restored.chat[0]?.text, "你好 🀄");
    },
  );
  await t.test("resignation and rematch require both players", async () => {
    c.send({ type: "resign" });
    assert.equal((await a.next("state")).state.winner, 1);
    await c.next("state");
    const completedMatch = await productStore.getMatch(matchId);
    assert.ok(completedMatch);
    assert.equal(completedMatch.status, "completed");
    assert.equal(completedMatch.outcome?.winnerSeat, 0);
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

void test("rated rooms require identities and settle ELO once", async (t) => {
  const { server, wss, productStore, rooms } = createServer();
  await once(server.listen(0, "127.0.0.1"), "listening");
  const url = `ws://127.0.0.1:${String(portOf(server))}`;
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await closeServer(server);
  });
  const anonymous = await client(url);
  anonymous.send({ type: "create", game: "gomoku", mode: "rated" });
  assert.match((await anonymous.next("error")).message, /身份/);

  const createIdentity = async (displayName: string) => {
    const user = await productStore.createUser({ displayName });
    const token = createSessionToken();
    await productStore.createSession({
      userId: user.id,
      token,
      expiresAt: Date.now() + 60_000,
    });
    return { user, token };
  };
  const first = await createIdentity("競技甲");
  const second = await createIdentity("競技乙");
  const a = await client(url, first.token);
  const b = await client(url, second.token);
  a.send({ type: "create", game: "gomoku", mode: "rated", name: "競技甲" });
  const joined = await a.next("joined");
  assert.equal(joined.mode, "rated");
  await a.next("state");
  b.send({ type: "join", code: joined.code, name: "競技乙" });
  const bJoined = await b.next("joined");
  assert.equal(bJoined.mode, "rated");
  await a.next("state");
  await b.next("state");
  assert.equal(roomAt(rooms, joined.code).mode, "rated");
  const matchId = roomAt(rooms, joined.code).matchId;
  assert.ok(matchId);
  assert.equal((await productStore.getMatch(matchId))?.mode, "rated");
  const impostorIdentity = await createIdentity("冒用者");
  const impostor = await client(url, impostorIdentity.token);
  impostor.send({
    type: "join",
    code: joined.code,
    token: bJoined.token,
  });
  assert.match((await impostor.next("error")).message, /相同玩家身份/);

  b.send({ type: "resign" });
  assert.equal((await a.next("state")).state.winner, 1);
  await b.next("state");
  const completed = await productStore.getMatch(matchId);
  assert.equal(completed?.status, "completed");
  const firstRating = await productStore.getUserRating(first.user.id, "gomoku");
  const secondRating = await productStore.getUserRating(
    second.user.id,
    "gomoku",
  );
  assert.deepEqual(
    {
      rating: firstRating.rating,
      gamesPlayed: firstRating.gamesPlayed,
      wins: firstRating.wins,
      losses: firstRating.losses,
      provisional: firstRating.provisional,
    },
    { rating: 1520, gamesPlayed: 1, wins: 1, losses: 0, provisional: true },
  );
  assert.equal(secondRating.rating, 1480);
  assert.equal(secondRating.losses, 1);
  const retried = await productStore.completeMatch({
    matchId,
    outcome: { winnerSeat: 0, reason: "對手認輸" },
  });
  assert.equal(retried.status, "completed");
  assert.equal(
    (await productStore.getUserRating(first.user.id, "gomoku")).rating,
    1520,
  );
});

void test("public matchmaking queues, cancels, and creates rated or casual rooms", async (t) => {
  const { server, wss, productStore, rooms } = createServer();
  await once(server.listen(0, "127.0.0.1"), "listening");
  const url = `ws://127.0.0.1:${String(portOf(server))}`;
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await closeServer(server);
  });
  const createIdentity = async (displayName: string) => {
    const user = await productStore.createUser({ displayName });
    const token = createSessionToken();
    await productStore.createSession({
      userId: user.id,
      token,
      expiresAt: Date.now() + 60_000,
    });
    return { user, token };
  };
  const first = await createIdentity("配對甲");
  const second = await createIdentity("配對乙");
  const third = await createIdentity("休閒甲");
  const fourth = await createIdentity("休閒乙");
  const a = await client(url, first.token);
  const b = await client(url, second.token);
  const c = await client(url, third.token);
  const d = await client(url, fourth.token);

  a.send({
    type: "matchmake",
    game: "gomoku",
    mode: "rated",
    timeControl: "unlimited",
  });
  const waiting = await a.next("matchmaking");
  assert.equal(waiting.status, "waiting");
  assert.ok(waiting.expiresAt);

  b.send({
    type: "matchmake",
    game: "gomoku",
    mode: "rated",
    timeControl: "unlimited",
  });
  assert.equal((await a.next("matchmaking")).status, "matched");
  assert.equal((await b.next("matchmaking")).status, "matched");
  const aJoined = await a.next("joined");
  const bJoined = await b.next("joined");
  assert.equal(aJoined.mode, "rated");
  assert.equal(bJoined.mode, "rated");
  await a.next("state");
  await b.next("state");
  const ratedRoom = roomAt(rooms, aJoined.code);
  assert.equal(ratedRoom.mode, "rated");
  assert.equal(
    (await productStore.getMatch(ratedRoom.matchId ?? ""))?.mode,
    "rated",
  );
  assert.deepEqual(
    (await productStore.getMatch(ratedRoom.matchId ?? ""))?.participants.map(
      (participant) => participant.userId,
    ),
    [first.user.id, second.user.id],
  );

  c.send({
    type: "matchmake",
    game: "gomoku",
    mode: "casual",
    timeControl: "unlimited",
  });
  const casualWaiting = await c.next("matchmaking");
  assert.equal(casualWaiting.status, "waiting");
  c.send({ type: "matchmake-cancel", ticket: casualWaiting.ticket });
  assert.equal((await c.next("matchmaking")).status, "cancelled");
  c.send({
    type: "matchmake",
    game: "gomoku",
    mode: "casual",
    timeControl: "unlimited",
  });
  assert.equal((await c.next("matchmaking")).status, "waiting");
  d.send({
    type: "matchmake",
    game: "gomoku",
    mode: "casual",
    timeControl: "unlimited",
  });
  assert.equal((await c.next("matchmaking")).status, "matched");
  assert.equal((await d.next("matchmaking")).status, "matched");
  const casualJoined = await c.next("joined");
  const dJoined = await d.next("joined");
  await c.next("state");
  await d.next("state");
  const casualRoom = roomAt(rooms, casualJoined.code);
  assert.equal(casualRoom.mode, "public");
  assert.equal(
    (await productStore.getMatch(casualRoom.matchId ?? ""))?.mode,
    "public",
  );
  const impostorIdentity = await createIdentity("冒用配對座位");
  const impostor = await client(url, impostorIdentity.token);
  impostor.send({
    type: "join",
    code: casualJoined.code,
    token: dJoined.token,
  });
  assert.match((await impostor.next("error")).message, /相同玩家身份/);
});

void test("riichi supports four private seats, pauses, and reconnects", async (t) => {
  const { server, wss, rooms } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${String(portOf(server))}`;
  t.after(async () => {
    for (const room of rooms.values()) room.session?.close();
    for (const ws of wss.clients) ws.terminate();
    await closeServer(server);
  });
  const clients = await Promise.all([0, 1, 2, 3].map(() => client(url)));
  const tokens: string[] = [];
  const hostClient = item(clients, 0);
  hostClient.send({
    type: "create",
    game: "riichi",
    rounds: 0,
    name: "東玩家",
  });
  const host = await hostClient.next("joined");
  tokens.push(host.token);
  const waiting = await hostClient.next("state");
  assert.equal(waiting.players.length, 4);
  assert.equal(waiting.state.phase, "waiting");
  for (let id = 1; id < 4; id++) {
    const currentClient = item(clients, id);
    currentClient.send({
      type: "join",
      code: host.code,
      name: `玩家${String(id)}`,
    });
    const joined = await currentClient.next("joined");
    tokens.push(joined.token);
    assert.equal(joined.side, id + 1);
  }
  const until = async (
    currentClient: TestClient,
    predicate: (message: StateMessage) => boolean,
  ): Promise<StateMessage> => {
    for (let n = 0; n < 30; n++) {
      const message = await currentClient.next("state");
      if (predicate(message)) return message;
    }
    throw new Error("No expected state");
  };
  const views = await Promise.all(
    clients.map((currentClient) =>
      until(currentClient, (message) => {
        if (!isRiichiView(message.state)) return false;
        return message.state.hand.length >= 13 && message.state.ply >= 3;
      }),
    ),
  );
  for (let id = 0; id < 4; id++) {
    const view = riichiView(item(views, id).state);
    assert.equal(view.seat, id);
    assert.equal(view.hand.length, id === 0 ? 14 : 13);
    const firstSeat = item(view.seats, 0);
    assert.equal(firstSeat.hand, undefined);
    assert.equal(firstSeat.shoupai, undefined);
  }
  const action = riichiView(item(views, 0).state).choices.find(
    (choice) => choice.kind === "discard",
  );
  assert.ok(action);
  item(clients, 1).send({ type: "riichi-action", actionId: action.id });
  assert.match((await item(clients, 1).next("error")).message, /座位/);
  const disconnected = item(clients, 2);
  disconnected.ws.close();
  await once(disconnected.ws, "close");
  await until(item(clients, 0), (message) => {
    const player = item(message.players, 2);
    return player?.online === false;
  });
  assert.equal(roomAt(rooms, host.code).session?.paused, true);
  hostClient.send({ type: "riichi-action", actionId: action.id });
  assert.match((await hostClient.next("error")).message, /等待/);
  const back = await client(url);
  back.send({ type: "join", code: host.code, token: item(tokens, 2) });
  assert.equal((await back.next("joined")).side, 3);
  const restored = await back.next("state");
  const restoredView = riichiView(restored.state);
  assert.equal(restoredView.seat, 2);
  assert.equal(restoredView.hand.length, 13);
  assert.equal(roomAt(rooms, host.code).session?.paused, false);
  hostClient.send({ type: "riichi-action", actionId: action.id });
  await until(hostClient, (message) => {
    const view = riichiView(message.state);
    return item(view.seats, 0).river.length === 1;
  });
});

void test("riichi host can fill empty seats with AI; bot seats cannot be stolen", async (t) => {
  const { server, wss, rooms } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${String(portOf(server))}`;
  t.after(async () => {
    for (const room of rooms.values()) room.session?.close();
    for (const ws of wss.clients) ws.terminate();
    await closeServer(server);
  });
  const a = await client(url);
  const b = await client(url);
  const intruder = await client(url);
  a.send({ type: "create", game: "riichi", rounds: 0 });
  const joined = await a.next("joined");
  await a.next("state");
  b.send({ type: "join", code: joined.code });
  await b.next("joined");
  await b.next("state");
  b.send({ type: "riichi-start" });
  assert.match((await b.next("error")).message, /房主/);
  a.send({ type: "riichi-start" });
  let started: StateMessage | undefined;
  for (let n = 0; n < 10; n++) {
    const message = await a.next("state");
    if (isRiichiView(message.state) && message.state.hand.length === 14) {
      started = message;
      break;
    }
  }
  assert.ok(started);
  assert.equal(started.players.filter((player) => player?.bot).length, 2);
  assert.equal(started.players.filter((player) => player?.online).length, 4);
  intruder.send({ type: "join", code: joined.code });
  assert.match((await intruder.next("error")).message, /已滿/);
});

void test("shogi works through the existing authoritative room protocol", async (t) => {
  const { server, wss } = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${String(portOf(server))}`;
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await closeServer(server);
  });
  const a = await client(url);
  const b = await client(url);
  a.send({ type: "create", game: "shogi" });
  const joined = await a.next("joined");
  await a.next("state");
  b.send({ type: "join", code: joined.code });
  await b.next("joined");
  await a.next("state");
  await b.next("state");
  a.send({ type: "move", ply: 0, move: { from: 56, to: 47 } });
  const sa = await a.next("state");
  const sb = await b.next("state");
  assert.deepEqual(sa.state, sb.state);
  const shogi = shogiState(sa.state);
  assert.equal(shogi.board[47], 1);
  assert.equal(shogi.turn, -1);
});

const postgresTestUrl = process.env.QIJU_TEST_DATABASE_URL;

if (!postgresTestUrl) {
  void test(
    "postgres-backed board rooms recover after server restart",
    { skip: "未設定 QIJU_TEST_DATABASE_URL" },
    () => {},
  );
} else {
  void test("postgres-backed board rooms recover after server restart", async (t) => {
    const store1 = new PostgresRoomStore({
      connectionString: postgresTestUrl,
    });
    const productStore1 = new PostgresProductStore({
      connectionString: postgresTestUrl,
    });
    const first = createServer({
      roomStore: store1,
      productStore: productStore1,
    });
    let second: ReturnType<typeof createServer> | null = null;
    let code: string | null = null;

    const stop = async (
      bundle: ReturnType<typeof createServer>,
    ): Promise<void> => {
      for (const ws of bundle.wss.clients) ws.terminate();
      if (bundle.server.listening) await closeServer(bundle.server);
    };

    t.after(async () => {
      await stop(first);
      if (second) await stop(second);
      if (code) {
        const cleanup = new PostgresRoomStore({
          connectionString: postgresTestUrl,
        });
        await cleanup.initialize();
        await cleanup.delete(code);
        await cleanup.close();
        const cleanupPool = new Pool({ connectionString: postgresTestUrl });
        await cleanupPool.query(
          "DELETE FROM qiju_matches WHERE room_code = $1",
          [code],
        );
        await cleanupPool.end();
      }
    });

    await first.ready;
    first.server.listen(0, "127.0.0.1");
    await once(first.server, "listening");
    const firstUrl = `ws://127.0.0.1:${String(portOf(first.server))}`;
    const host = await client(firstUrl);
    const guest = await client(firstUrl);

    host.send({ type: "create", game: "gomoku", name: "甲" });
    const joined = await host.next("joined");
    code = joined.code;
    await host.next("state");
    guest.send({ type: "join", code: joined.code, name: "乙" });
    const guestJoined = await guest.next("joined");
    await host.next("state");
    await guest.next("state");
    host.send({ type: "move", ply: 0, move: { to: 112 } });
    const beforeRestart = await host.next("state");
    await guest.next("state");
    assert.equal(numericState(beforeRestart.state).board[112], 1);
    await stop(first);

    const store2 = new PostgresRoomStore({
      connectionString: postgresTestUrl,
    });
    const productStore2 = new PostgresProductStore({
      connectionString: postgresTestUrl,
    });
    second = createServer({
      roomStore: store2,
      productStore: productStore2,
    });
    await second.ready;
    second.server.listen(0, "127.0.0.1");
    await once(second.server, "listening");
    const secondUrl = `ws://127.0.0.1:${String(portOf(second.server))}`;
    const resumedHost = await client(secondUrl);
    const resumedGuest = await client(secondUrl);
    resumedHost.send({
      type: "join",
      code: joined.code,
      token: joined.token,
    });
    assert.equal((await resumedHost.next("joined")).side, 1);
    await resumedHost.next("state");
    resumedGuest.send({
      type: "join",
      code: joined.code,
      token: guestJoined.token,
    });
    assert.equal((await resumedGuest.next("joined")).side, -1);
    const resumed = await resumedHost.next("state");
    await resumedGuest.next("state");
    const resumedState = numericState(resumed.state);
    assert.equal(resumedState.ply, 1);
    assert.equal(resumedState.board[112], 1);
    assert.equal(item(resumed.players, 0)?.name, "甲");
    assert.equal(item(resumed.players, 1)?.name, "乙");
  });

  void test("postgres-backed riichi sessions recover after server restart", async (t) => {
    const store1 = new PostgresRoomStore({
      connectionString: postgresTestUrl,
    });
    const productStore1 = new PostgresProductStore({
      connectionString: postgresTestUrl,
    });
    const first = createServer({
      roomStore: store1,
      productStore: productStore1,
    });
    let second: ReturnType<typeof createServer> | null = null;
    let code: string | null = null;

    const stop = async (
      bundle: ReturnType<typeof createServer>,
    ): Promise<void> => {
      for (const ws of bundle.wss.clients) ws.terminate();
      if (bundle.server.listening) await closeServer(bundle.server);
    };

    t.after(async () => {
      await stop(first);
      if (second) await stop(second);
      if (code) {
        const cleanup = new PostgresRoomStore({
          connectionString: postgresTestUrl,
        });
        await cleanup.initialize();
        await cleanup.delete(code);
        await cleanup.close();
        const cleanupPool = new Pool({ connectionString: postgresTestUrl });
        await cleanupPool.query(
          "DELETE FROM qiju_matches WHERE room_code = $1",
          [code],
        );
        await cleanupPool.end();
      }
    });

    await first.ready;
    first.server.listen(0, "127.0.0.1");
    await once(first.server, "listening");
    const firstUrl = `ws://127.0.0.1:${String(portOf(first.server))}`;
    const clients = await Promise.all(
      Array.from({ length: 4 }, () => client(firstUrl)),
    );
    const tokens: string[] = [];
    const host = item(clients, 0);
    host.send({ type: "create", game: "riichi", rounds: 0, name: "甲" });
    const joined = await host.next("joined");
    code = joined.code;
    tokens.push(joined.token);
    await host.next("state");
    for (let id = 1; id < 4; id++) {
      const current = item(clients, id);
      current.send({
        type: "join",
        code: joined.code,
        name: `玩家${String(id)}`,
      });
      const currentJoined = await current.next("joined");
      tokens.push(currentJoined.token);
      await current.next("state");
    }

    const until = async (
      current: TestClient,
      predicate: (message: StateMessage) => boolean,
    ): Promise<StateMessage> => {
      for (let n = 0; n < 40; n++) {
        const message = await current.next("state");
        if (predicate(message)) return message;
      }
      throw new Error("No expected state");
    };
    const before = await until(host, (message) => {
      if (!isRiichiView(message.state)) return false;
      const view = riichiView(message.state);
      return view.hand.length === 14 && view.ply >= 3;
    });
    const beforeView = riichiView(before.state);
    await stop(first);

    const store2 = new PostgresRoomStore({
      connectionString: postgresTestUrl,
    });
    const productStore2 = new PostgresProductStore({
      connectionString: postgresTestUrl,
    });
    second = createServer({
      roomStore: store2,
      productStore: productStore2,
    });
    await second.ready;
    second.server.listen(0, "127.0.0.1");
    await once(second.server, "listening");
    const secondUrl = `ws://127.0.0.1:${String(portOf(second.server))}`;
    const resumedClients = await Promise.all(
      Array.from({ length: 4 }, () => client(secondUrl)),
    );
    const initialResumedStates: StateMessage[] = [];
    for (let id = 0; id < 4; id++) {
      const current = item(resumedClients, id);
      current.send({
        type: "join",
        code: joined.code,
        token: item(tokens, id),
      });
      assert.equal((await current.next("joined")).side, id + 1);
      initialResumedStates.push(await current.next("state"));
    }

    const resumedMessages = await Promise.all(
      resumedClients.map((current, id) => {
        const initial = item(initialResumedStates, id);
        if (isRiichiView(initial.state) && !riichiView(initial.state).paused)
          return Promise.resolve(initial);
        return until(current, (message) => {
          if (!isRiichiView(message.state)) return false;
          const view = riichiView(message.state);
          return view.ply === beforeView.ply && !view.paused;
        });
      }),
    );
    const resumedView = riichiView(item(resumedMessages, 0).state);
    assert.deepEqual(resumedView, beforeView);

    const action = resumedView.choices.find(
      (choice) => choice.kind === "discard",
    );
    assert.ok(action);
    item(resumedClients, 0).send({
      type: "riichi-action",
      actionId: action.id,
    });
    await until(item(resumedClients, 0), (message) => {
      if (!isRiichiView(message.state)) return false;
      return riichiView(message.state).seats[0]?.river.length === 1;
    });
  });
}

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { RiichiSession } from "../../lib/riichi-session.js";
import { applyMove, createGame, scoringAction } from "../shared/engine.js";
import {
  parseClientMessage,
  type ClientMessage,
  type PlayerSide,
} from "../shared/protocol.js";
import type {
  ClientSocket,
  RiichiSide,
  Room,
  RoomPlayer,
  RoomState,
  SocketSide,
} from "./room-types.js";
import { createStaticHttpServer, parsePort } from "./http-server.js";

const asClientSocket = (socket: WebSocket): ClientSocket =>
  socket as ClientSocket;

const send = (socket: ClientSocket, data: unknown): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
};

const roomSide = (state: RoomState, index: number): SocketSide => {
  if (state.game !== "riichi") return index === 0 ? 1 : -1;
  const side = index + 1;
  if (side < 1 || side > 4) throw new Error("無效座位");
  return side as RiichiSide;
};

const boardSide = (side: SocketSide): PlayerSide => {
  if (side === 1 || side === -1) return side;
  throw new Error("只有棋類房間可執行此操作");
};

const seatIndex = (side: SocketSide): number => {
  if (side < 1 || side > 4) throw new Error("無效日麻座位");
  return side - 1;
};

const normalizeName = (value: string | undefined, index: number): string =>
  value?.trim().slice(0, 20) || `玩家 ${String(index + 1)}`;

const rawText = (raw: RawData): string => {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
};

export function createServer() {
  const rooms = new Map<string, Room>();
  const server = createStaticHttpServer();

  const wss = new WebSocketServer({ server, maxPayload: 8192 });

  const broadcast = (room: Room): void => {
    room.players.forEach((player, index) => {
      if (!player?.socket) return;
      send(player.socket, {
        type: "state",
        code: room.code,
        side: roomSide(room.state, index),
        state: room.session ? room.session.view(index) : room.state,
        players: room.players.map((entry) =>
          entry
            ? {
                name: entry.name,
                online: Boolean(entry.socket) || Boolean(entry.bot),
                bot: Boolean(entry.bot),
              }
            : null,
        ),
        rematch: room.rematch,
      });
    });
  };

  const ready = (room: Room): boolean =>
    room.players.every((player) =>
      Boolean(player && (player.bot || player.socket)),
    );

  const startRiichi = (room: Room): void => {
    if (room.session) return;
    room.session = new RiichiSession({
      humans: room.players.flatMap((player, index) =>
        player && !player.bot ? [index] : [],
      ),
      rounds: room.rounds,
      names: room.players.map(
        (player, index) => player?.name ?? `玩家 ${String(index + 1)}`,
      ),
      onChange: () => {
        if (!room.session) return;
        room.state = {
          game: "riichi",
          winner: room.session.done
            ? (room.session.result?.rank?.indexOf(1) ?? -1) + 1
            : null,
          ply: room.session.revision,
        };
        room.touched = Date.now();
        broadcast(room);
      },
      onError: () => {
        room.players.forEach((player) => {
          if (player?.socket)
            send(player.socket, {
              type: "error",
              message: "日麻對局暫停，請重新建立房間",
            });
        });
      },
    });
    room.session.start();
  };

  const detach = (socket: ClientSocket): void => {
    if (!socket.room) return;
    const room = rooms.get(socket.room);
    if (!room) {
      socket.room = null;
      return;
    }
    const player = room.players.find((entry) => entry?.socket === socket);
    if (player) {
      player.socket = null;
      room.session?.pause(true);
      room.touched = Date.now();
      broadcast(room);
    }
    socket.room = null;
  };

  const handleRoomEntry = (
    socket: ClientSocket,
    message: Extract<ClientMessage, { type: "create" | "join" }>,
  ): void => {
    if (socket.room) throw new Error("請先離開目前房間");
    let room: Room;
    let index: number;
    if (message.type === "create") {
      if (rooms.size >= 500) throw new Error("房間已滿，請稍後再試");
      const state = createGame(message.game, message.size);
      const rounds =
        message.rounds !== undefined && [0, 1, 2].includes(message.rounds)
          ? message.rounds
          : 1;
      let code: string;
      do {
        code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      } while (rooms.has(code));
      room = {
        code,
        state,
        players: Array<RoomPlayer | null>(
          message.game === "riichi" ? 4 : 2,
        ).fill(null),
        rounds,
        rematch: [],
        touched: Date.now(),
        session: null,
      };
      rooms.set(code, room);
      index = 0;
    } else {
      const joinedRoom = rooms.get(message.code.toUpperCase());
      if (!joinedRoom) throw new Error("找不到房間，請確認房間代碼");
      room = joinedRoom;
      index = room.players.findIndex((player) =>
        Boolean(player?.token && player.token === message.token),
      );
      if (index < 0) index = room.players.findIndex((player) => !player);
      if (index < 0) throw new Error("房間已滿");
    }

    const existing = room.players[index];
    if (existing?.socket && existing.socket !== socket) {
      existing.socket.room = null;
      existing.socket.close(4001, "Session replaced");
    }
    const token = existing?.token ?? randomBytes(24).toString("hex");
    const name = existing?.name ?? normalizeName(message.name, index);
    room.players[index] = { name, token, socket };
    socket.room = room.code;
    socket.side = roomSide(room.state, index);
    room.touched = Date.now();
    send(socket, { type: "joined", code: room.code, token, side: socket.side });
    if (room.state.game === "riichi" && ready(room)) {
      if (room.session) room.session.pause(false);
      else startRiichi(room);
    }
    broadcast(room);
  };

  wss.on("connection", (rawSocket) => {
    const socket = asClientSocket(rawSocket);
    socket.alive = true;
    socket.room = null;
    socket.side = 1;
    socket.on("pong", () => {
      socket.alive = true;
    });
    let windowStart = Date.now();
    let count = 0;
    socket.on("message", (raw: RawData) => {
      try {
        if (Date.now() - windowStart > 1000) {
          windowStart = Date.now();
          count = 0;
        }
        count++;
        if (count > 40) throw new Error("操作過於頻繁");
        const message = parseClientMessage(JSON.parse(rawText(raw)) as unknown);
        if (message.type === "create" || message.type === "join") {
          handleRoomEntry(socket, message);
          return;
        }
        if (message.type === "leave") {
          detach(socket);
          send(socket, { type: "left" });
          return;
        }

        if (!socket.room) throw new Error("尚未加入房間");
        const room = rooms.get(socket.room);
        if (!room) throw new Error("尚未加入房間");

        if (message.type === "riichi-start") {
          if (room.state.game !== "riichi" || socket.side !== 1 || room.session)
            throw new Error("只有房主可在開局前補入 AI");
          if (
            room.players.some(
              (player) => player && !player.bot && !player.socket,
            )
          )
            throw new Error("請等待已加入的玩家重新連線");
          room.players = room.players.map(
            (player, index) =>
              player ?? {
                name: `AI 玩家 ${String(index + 1)}`,
                token: randomBytes(24).toString("hex"),
                bot: true,
              },
          );
          startRiichi(room);
          return;
        }

        if (!ready(room)) throw new Error("等待對手連線");
        if (message.type === "riichi-action") {
          if (room.state.game !== "riichi" || !room.session)
            throw new Error("日麻尚未開局");
          room.session.act(seatIndex(socket.side), message.actionId);
          return;
        }
        if (message.type === "move") {
          if (room.state.game === "riichi")
            throw new Error("日麻請使用專用操作");
          const side = boardSide(socket.side);
          if (room.state.turn !== side) throw new Error("還沒輪到你");
          if (message.ply !== room.state.ply)
            throw new Error("棋局已更新，請重新落子");
          room.state = applyMove(room.state, message.move);
        } else if (
          message.type === "dead" ||
          message.type === "accept" ||
          message.type === "resume"
        ) {
          if (room.state.game !== "go") throw new Error("目前不在圍棋數子階段");
          room.state = scoringAction(
            room.state,
            {
              type: message.type,
              ...(message.to === undefined ? {} : { to: message.to }),
            },
            boardSide(socket.side),
          );
        } else if (message.type === "resign") {
          if (room.state.game === "riichi")
            throw new Error("日麻請透過返回大廳離開，對局將暫停");
          if (room.state.winner !== null) throw new Error("本局已結束");
          const side = boardSide(socket.side);
          room.state = {
            ...room.state,
            winner: side === 1 ? -1 : 1,
            reason: "對手認輸",
          };
        } else {
          if (room.state.winner === null) throw new Error("請先完成本局");
          room.rematch = [...new Set([...room.rematch, socket.side])];
          const humanCount = room.players.filter(
            (player) => player !== null && !player.bot,
          ).length;
          if (room.rematch.length === humanCount) {
            room.rematch = [];
            if (room.state.game === "riichi") {
              room.session?.close();
              room.session = null;
              startRiichi(room);
            } else {
              room.state = createGame(room.state.game, room.state.rows);
            }
          }
        }
        room.touched = Date.now();
        broadcast(room);
      } catch (error: unknown) {
        send(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "伺服器錯誤",
        });
      }
    });
    socket.on("close", () => {
      detach(socket);
    });
    socket.on("error", () => {});
  });

  const timer = setInterval(() => {
    for (const rawSocket of wss.clients) {
      const socket = asClientSocket(rawSocket);
      if (!socket.alive) {
        socket.terminate();
        continue;
      }
      socket.alive = false;
      socket.ping();
    }
    for (const [code, room] of rooms) {
      if (
        !room.players.some((player) => Boolean(player?.socket)) &&
        Date.now() - room.touched > 30 * 60 * 1000
      ) {
        room.session?.close();
        rooms.delete(code);
      }
    }
  }, 30000);
  timer.unref();
  server.on("close", () => {
    clearInterval(timer);
    for (const room of rooms.values()) room.session?.close();
    wss.close();
  });
  return { server, wss, rooms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createServer();
  const port = parsePort(process.env.PORT);
  server.listen(port, "0.0.0.0", () => {
    console.log(`棋聚已啟動：http://localhost:${String(port)}`);
  });
}

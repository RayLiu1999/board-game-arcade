import { randomBytes } from "node:crypto";
import type { Server } from "node:http";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import { applyMove, createGame, scoringAction } from "../shared/engine.js";
import { parseClientMessage, type PlayerSide } from "../shared/protocol.js";
import type { ClientSocket, SocketSide } from "./room-types.js";
import { send } from "./room-manager.js";
import type { RoomManager } from "./room-manager.js";

const asClientSocket = (socket: WebSocket): ClientSocket =>
  socket as ClientSocket;

const boardSide = (side: SocketSide): PlayerSide => {
  if (side === 1 || side === -1) return side;
  throw new Error("只有棋類房間可執行此操作");
};

const seatIndex = (side: SocketSide): number => {
  if (side < 1 || side > 4) throw new Error("無效日麻座位");
  return side - 1;
};

const rawText = (raw: RawData): string => {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
};

export const attachWebSocketServer = (
  server: Server,
  roomManager: RoomManager,
): WebSocketServer => {
  const { rooms } = roomManager;
  const wss = new WebSocketServer({ server, maxPayload: 8192 });

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
          roomManager.handleEntry(socket, message);
          return;
        }
        if (message.type === "leave") {
          roomManager.detach(socket);
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
          roomManager.startRiichi(room);
          return;
        }

        if (!roomManager.isReady(room)) throw new Error("等待對手連線");
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
              roomManager.startRiichi(room);
            } else {
              room.state = createGame(room.state.game, room.state.rows);
            }
          }
        }
        room.touched = Date.now();
        roomManager.broadcast(room);
      } catch (error: unknown) {
        send(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "伺服器錯誤",
        });
      }
    });
    socket.on("close", () => {
      roomManager.detach(socket);
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
    roomManager.pruneInactive();
  }, 30000);
  timer.unref();
  server.on("close", () => {
    clearInterval(timer);
    roomManager.closeAll();
    wss.close();
  });
  return wss;
};

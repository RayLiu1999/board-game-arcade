import type { Server } from "node:http";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import { parseClientMessage } from "../shared/protocol.js";
import type { ClientSocket } from "./room-types.js";
import { handleClientMessage } from "./game-protocol.js";
import { send } from "./room-manager.js";
import type { RoomManager } from "./room-manager.js";

const asClientSocket = (socket: WebSocket): ClientSocket =>
  socket as ClientSocket;

const rawText = (raw: RawData): string => {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
};

export const attachWebSocketServer = (
  server: Server,
  roomManager: RoomManager,
): WebSocketServer => {
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
        handleClientMessage(socket, message, roomManager);
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

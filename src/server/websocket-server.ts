import type { IncomingMessage, Server } from "node:http";
import { randomUUID } from "node:crypto";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import { parseClientMessage } from "../shared/protocol.js";
import type { ClientSocket } from "./room-types.js";
import { handleClientMessage } from "./game-protocol.js";
import type { ProductIdentityService } from "./product-identity.js";
import { sessionTokenFromCookie } from "./product-security.js";
import { send } from "./room-manager.js";
import type { RoomManager } from "./room-manager.js";

const asClientSocket = (socket: WebSocket): ClientSocket =>
  socket as ClientSocket;
const PRESENCE_TTL_MS = 90_000;

const rawText = (raw: RawData): string => {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
};

export const attachWebSocketServer = (
  server: Server,
  roomManager: RoomManager,
  identity?: ProductIdentityService,
): WebSocketServer => {
  const wss = new WebSocketServer({ server, maxPayload: 8192 });
  const presenceIds = new WeakMap<ClientSocket, string>();
  const sessionTokens = new WeakMap<ClientSocket, string>();
  const authenticatedSockets = new WeakSet<ClientSocket>();

  wss.on("connection", (rawSocket, request: IncomingMessage) => {
    const socket = asClientSocket(rawSocket);
    const presenceId = randomUUID();
    presenceIds.set(socket, presenceId);
    let disconnected = false;
    socket.alive = true;
    socket.room = null;
    socket.matchmakingTicketId = null;
    socket.side = 1;
    socket.chatWindowStartedAt = 0;
    socket.chatMessageCount = 0;
    const token = sessionTokenFromCookie(request.headers.cookie);
    if (token) sessionTokens.set(socket, token);
    const identityReady = token
      ? (identity?.authenticate(token) ?? Promise.resolve(null))
      : Promise.resolve(null);
    void identityReady
      .then((authenticated) => {
        if (!authenticated || disconnected) return;
        authenticatedSockets.add(socket);
        socket.userId = authenticated.user.id;
        const now = Date.now();
        return roomManager.productStore
          .touchPresence(
            presenceId,
            authenticated.user.id,
            now,
            now + PRESENCE_TTL_MS,
          )
          .catch(() => {});
      })
      .catch(() => {});
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
        void Promise.all([roomManager.ready, identityReady])
          .then(([, authenticated]) => {
            if (authenticated) socket.userId = authenticated.user.id;
            return handleClientMessage(socket, message, roomManager);
          })
          .catch((error: unknown) => {
            send(socket, {
              type: "error",
              message: error instanceof Error ? error.message : "伺服器錯誤",
            });
          });
      } catch (error: unknown) {
        send(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "伺服器錯誤",
        });
      }
    });
    socket.on("close", () => {
      disconnected = true;
      void roomManager.productStore.removePresence(presenceId).catch(() => {});
      void roomManager.detach(socket);
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
      const token = sessionTokens.get(socket);
      const presenceId = presenceIds.get(socket);
      if (token && presenceId && identity && authenticatedSockets.has(socket)) {
        void identity
          .authenticate(token)
          .then(async (authenticated) => {
            if (!authenticated) {
              socket.close(4002, "Authentication expired");
              return;
            }
            socket.userId = authenticated.user.id;
            const now = Date.now();
            await roomManager.productStore.touchPresence(
              presenceId,
              authenticated.user.id,
              now,
              now + PRESENCE_TTL_MS,
            );
          })
          .catch(() => {});
      }
    }
    void roomManager.pruneInactive();
  }, 30000);
  timer.unref();
  server.on("close", () => {
    clearInterval(timer);
    void roomManager.closeAll();
    wss.close();
  });
  return wss;
};

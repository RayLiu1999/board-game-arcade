import { fileURLToPath } from "node:url";

import type { Server } from "node:http";

import { createStaticHttpServer, parsePort } from "./http-server.js";
import { RoomManager } from "./room-manager.js";
import type { RoomStore } from "./room-store.js";
import { attachWebSocketServer } from "./websocket-server.js";

export interface ServerOptions {
  roomStore?: RoomStore;
}

export interface ServerBundle {
  readonly server: Server;
  readonly wss: ReturnType<typeof attachWebSocketServer>;
  readonly rooms: RoomManager["rooms"];
  readonly ready: Promise<void>;
}

export function createServer(options: ServerOptions = {}): ServerBundle {
  const roomManager = new RoomManager(
    options.roomStore ? { store: options.roomStore } : {},
  );
  const { rooms } = roomManager;
  const server = createStaticHttpServer();
  const wss = attachWebSocketServer(server, roomManager);
  return { server, wss, rooms, ready: roomManager.ready };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parsePort(process.env.PORT);
  const { server, ready } = createServer();
  void ready
    .then(() => {
      server.listen(port, "0.0.0.0", () => {
        console.log(`棋聚已啟動：http://localhost:${String(port)}`);
      });
    })
    .catch((error: unknown) => {
      console.error("房間儲存初始化失敗", error);
      process.exitCode = 1;
    });
}

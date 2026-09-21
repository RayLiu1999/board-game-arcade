import { fileURLToPath } from "node:url";

import type { Server } from "node:http";

import { createStaticHttpServer, parsePort } from "./http-server.js";
import { RoomManager } from "./room-manager.js";
import { attachWebSocketServer } from "./websocket-server.js";

export interface ServerBundle {
  readonly server: Server;
  readonly wss: ReturnType<typeof attachWebSocketServer>;
  readonly rooms: RoomManager["rooms"];
}

export function createServer(): ServerBundle {
  const roomManager = new RoomManager();
  const { rooms } = roomManager;
  const server = createStaticHttpServer();
  const wss = attachWebSocketServer(server, roomManager);
  return { server, wss, rooms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createServer();
  const port = parsePort(process.env.PORT);
  server.listen(port, "0.0.0.0", () => {
    console.log(`棋聚已啟動：http://localhost:${String(port)}`);
  });
}

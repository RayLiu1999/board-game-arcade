import { fileURLToPath } from "node:url";

import type { Server } from "node:http";

import { createStaticHttpServer, parsePort } from "./http-server.js";
import { RoomManager } from "./room-manager.js";
import type { RoomStore } from "./room-store.js";
import { ProductIdentityService } from "./product-identity.js";
import type { ProductStore } from "./product-store.js";
import { createProductHttpHandler } from "./product-http.js";
import {
  createConfiguredProductStore,
  createConfiguredRoomStore,
} from "./room-store-factory.js";
import { attachWebSocketServer } from "./websocket-server.js";

const log = (message: string): void => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

const logError = (message: string, error: unknown): void => {
  console.error(`[${new Date().toISOString()}] ${message}`, error);
};

export interface ServerOptions {
  roomStore?: RoomStore;
  productStore?: ProductStore;
}

export interface ServerBundle {
  readonly server: Server;
  readonly wss: ReturnType<typeof attachWebSocketServer>;
  readonly rooms: RoomManager["rooms"];
  readonly productStore: RoomManager["productStore"];
  readonly identity: ProductIdentityService;
  readonly ready: Promise<void>;
}

export function createServer(options: ServerOptions = {}): ServerBundle {
  const roomManager = new RoomManager({
    ...(options.roomStore ? { store: options.roomStore } : {}),
    ...(options.productStore ? { productStore: options.productStore } : {}),
  });
  const { rooms } = roomManager;
  const identity = new ProductIdentityService(
    roomManager.productStore,
    roomManager.productStore,
  );
  const server = createStaticHttpServer({
    api: createProductHttpHandler({
      identity,
      productStore: roomManager.productStore,
      claimRoom: (code, roomToken, userId) =>
        roomManager.claimPlayerIdentity(code, roomToken, userId),
    }),
  });
  const wss = attachWebSocketServer(server, roomManager, identity);
  return {
    server,
    wss,
    rooms,
    productStore: roomManager.productStore,
    identity,
    ready: roomManager.ready,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parsePort(process.env.PORT);
  const { server, ready } = createServer({
    roomStore: createConfiguredRoomStore(),
    productStore: createConfiguredProductStore(),
  });
  void ready
    .then(() => {
      server.listen(port, "0.0.0.0", () => {
        log(`棋聚已啟動：http://localhost:${String(port)}`);
      });
    })
    .catch((error: unknown) => {
      logError("房間儲存初始化失敗", error);
      process.exitCode = 1;
    });
}

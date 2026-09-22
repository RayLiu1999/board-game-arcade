import { PostgresRoomStore } from "./postgres-room-store.js";
import { MemoryRoomStore, type RoomStore } from "./room-store.js";
import { PostgresProductStore } from "./postgres-product-store.js";
import { MemoryProductStore, type ProductStore } from "./product-store.js";

export const createConfiguredRoomStore = (
  env: NodeJS.ProcessEnv = process.env,
): RoomStore => {
  if (env.QIJU_ROOM_STORE === "memory" || !env.DATABASE_URL)
    return new MemoryRoomStore();
  return new PostgresRoomStore({ connectionString: env.DATABASE_URL });
};

export const createConfiguredProductStore = (
  env: NodeJS.ProcessEnv = process.env,
): ProductStore => {
  if (env.QIJU_ROOM_STORE === "memory" || !env.DATABASE_URL)
    return new MemoryProductStore();
  return new PostgresProductStore({ connectionString: env.DATABASE_URL });
};

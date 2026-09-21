import { randomBytes } from "node:crypto";

import { WebSocket } from "ws";

import { RiichiSession } from "../../lib/riichi-session.js";
import { createGame } from "../shared/engine.js";
import type { ClientMessage } from "../shared/protocol.js";
import {
  type ClientSocket,
  type RiichiSide,
  type Room,
  type RoomState,
  type SocketSide,
} from "./room-types.js";
import {
  createRoomToken,
  hashRoomToken,
  matchesRoomToken,
} from "./room-security.js";
import {
  MemoryRoomStore,
  ROOM_TTL_MS,
  type RoomSnapshot,
  type RoomStore,
} from "./room-store.js";

export type SendMessage = (socket: ClientSocket, data: unknown) => void;

export interface RoomManagerOptions {
  sendMessage?: SendMessage;
  store?: RoomStore;
  now?: () => number;
}

export const send: SendMessage = (socket, data) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
};

const roomSide = (state: RoomState, index: number): SocketSide => {
  if (state.game !== "riichi") return index === 0 ? 1 : -1;
  const side = index + 1;
  if (side < 1 || side > 4) throw new Error("無效座位");
  return side as RiichiSide;
};

const normalizeName = (value: string | undefined, index: number): string =>
  value?.trim().slice(0, 20) || `玩家 ${String(index + 1)}`;

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly ready: Promise<void>;

  private readonly sendMessage: SendMessage;
  private readonly store: RoomStore;
  private readonly now: () => number;
  private readonly roomLocks = new Map<string, Promise<void>>();
  private entryLock: Promise<void> = Promise.resolve();

  constructor(options: RoomManagerOptions = {}) {
    this.sendMessage = options.sendMessage ?? send;
    this.store = options.store ?? new MemoryRoomStore();
    this.now = options.now ?? Date.now;
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    await this.store.initialize();
    const now = this.now();
    await this.store.pruneExpired(now, []);
    const snapshots = await this.store.load(now);
    for (const snapshot of snapshots)
      this.rooms.set(snapshot.code, restore(snapshot));
  }

  private snapshot(room: Room): RoomSnapshot | null {
    if (room.state.game === "riichi") return null;
    return {
      code: room.code,
      state: structuredClone(room.state),
      players: room.players.map((player) =>
        player
          ? {
              name: player.name,
              tokenHash: player.tokenHash,
              bot: Boolean(player.bot),
            }
          : null,
      ),
      rounds: room.rounds,
      rematch: [...room.rematch],
      revision: room.revision,
      touched: room.touched,
      expiresAt: room.expiresAt,
    };
  }

  touch(room: Room): void {
    room.touched = this.now();
    room.expiresAt = room.touched + ROOM_TTL_MS;
  }

  async persist(room: Room): Promise<void> {
    const snapshot = this.snapshot(room);
    if (!snapshot) return;
    room.revision = await this.store.update(snapshot, room.revision);
  }

  async runExclusive<Value>(
    code: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const previous = this.roomLocks.get(code) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.roomLocks.set(code, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.roomLocks.get(code) === current) this.roomLocks.delete(code);
    }
  }

  private async runEntry<Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const previous = this.entryLock;
    let release!: () => void;
    this.entryLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async createPersistentRoom(room: Room): Promise<void> {
    const snapshot = this.snapshot(room);
    if (snapshot) await this.store.create(snapshot);
  }

  broadcast(room: Room): void {
    room.players.forEach((player, index) => {
      if (!player?.socket) return;
      this.sendMessage(player.socket, {
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
  }

  isReady(room: Room): boolean {
    return room.players.every((player) =>
      Boolean(player && (player.bot || player.socket)),
    );
  }

  startRiichi(room: Room): void {
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
        this.broadcast(room);
      },
      onError: () => {
        room.players.forEach((player) => {
          if (player?.socket)
            this.sendMessage(player.socket, {
              type: "error",
              message: "日麻對局暫停，請重新建立房間",
            });
        });
      },
    });
    room.session.start();
  }

  async detach(socket: ClientSocket): Promise<void> {
    const code = socket.room;
    if (!code) return;
    await this.runExclusive(code, async () => {
      const room = this.rooms.get(code);
      if (!room) {
        socket.room = null;
        return;
      }
      const player = room.players.find((entry) => entry?.socket === socket);
      if (player) {
        player.socket = null;
        room.session?.pause(true);
        this.touch(room);
        await this.persist(room);
        this.broadcast(room);
      }
      socket.room = null;
    });
  }

  async handleEntry(
    socket: ClientSocket,
    message: Extract<ClientMessage, { type: "create" | "join" }>,
  ): Promise<void> {
    await this.ready;
    await this.runEntry(() => this.handleEntryUnsafe(socket, message));
  }

  private async handleEntryUnsafe(
    socket: ClientSocket,
    message: Extract<ClientMessage, { type: "create" | "join" }>,
  ): Promise<void> {
    if (socket.room) throw new Error("請先離開目前房間");
    let room: Room;
    let index: number;
    if (message.type === "create") {
      if (this.rooms.size >= 500) throw new Error("房間已滿，請稍後再試");
      const state = createGame(message.game, message.size);
      const rounds =
        message.rounds !== undefined && [0, 1, 2].includes(message.rounds)
          ? message.rounds
          : 1;
      let code: string;
      do {
        code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      } while (this.rooms.has(code));
      room = {
        code,
        state,
        players: Array<Room["players"][number]>(
          message.game === "riichi" ? 4 : 2,
        ).fill(null),
        rounds,
        rematch: [],
        touched: this.now(),
        expiresAt: this.now() + ROOM_TTL_MS,
        revision: 0,
        session: null,
      };
      await this.createPersistentRoom(room);
      this.rooms.set(code, room);
      index = 0;
    } else {
      const joinedRoom = this.rooms.get(message.code.toUpperCase());
      if (!joinedRoom) throw new Error("找不到房間，請確認房間代碼");
      room = joinedRoom;
      index = room.players.findIndex((player) =>
        Boolean(
          player?.tokenHash &&
            message.token &&
            matchesRoomToken(message.token, player.tokenHash),
        ),
      );
      if (index < 0) index = room.players.findIndex((player) => !player);
      if (index < 0) throw new Error("房間已滿");
    }

    const existing = room.players[index];
    if (existing?.socket && existing.socket !== socket) {
      existing.socket.room = null;
      existing.socket.close(4001, "Session replaced");
    }
    const token =
      message.type === "join" && message.token
        ? message.token
        : createRoomToken();
    const name = existing?.name ?? normalizeName(message.name, index);
    room.players[index] = {
      name,
      tokenHash: existing?.tokenHash ?? hashRoomToken(token),
      socket,
      ...(existing?.bot ? { bot: true } : {}),
    };
    socket.room = room.code;
    socket.side = roomSide(room.state, index);
    this.touch(room);
    await this.persist(room);
    this.sendMessage(socket, {
      type: "joined",
      code: room.code,
      token,
      side: socket.side,
    });
    if (room.state.game === "riichi" && this.isReady(room)) {
      if (room.session) room.session.pause(false);
      else this.startRiichi(room);
    }
    this.broadcast(room);
  }

  async pruneInactive(now = this.now()): Promise<void> {
    for (const [code] of this.rooms) {
      await this.runExclusive(code, async () => {
        const room = this.rooms.get(code);
        if (
          room &&
          !room.players.some((player) => Boolean(player?.socket)) &&
          now >= room.expiresAt
        ) {
          room.session?.close();
          this.rooms.delete(code);
          await this.store.delete(code);
        }
      });
    }
    await this.store.pruneExpired(now, [...this.rooms.keys()]);
  }

  async closeAll(): Promise<void> {
    for (const room of this.rooms.values()) room.session?.close();
    await this.store.close();
  }
}

const restore = (snapshot: RoomSnapshot): Room => ({
  code: snapshot.code,
  state: structuredClone(snapshot.state),
  players: snapshot.players.map((player) =>
    player
      ? {
          name: player.name,
          tokenHash: player.tokenHash,
          bot: player.bot,
          socket: null,
        }
      : null,
  ),
  rounds: snapshot.rounds,
  rematch: [...snapshot.rematch],
  touched: snapshot.touched,
  expiresAt: snapshot.expiresAt,
  revision: snapshot.revision,
  session: null,
});

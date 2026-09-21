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

export type SendMessage = (socket: ClientSocket, data: unknown) => void;

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

  constructor(private readonly sendMessage: SendMessage = send) {}

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

  detach(socket: ClientSocket): void {
    if (!socket.room) return;
    const room = this.rooms.get(socket.room);
    if (!room) {
      socket.room = null;
      return;
    }
    const player = room.players.find((entry) => entry?.socket === socket);
    if (player) {
      player.socket = null;
      room.session?.pause(true);
      room.touched = Date.now();
      this.broadcast(room);
    }
    socket.room = null;
  }

  handleEntry(
    socket: ClientSocket,
    message: Extract<ClientMessage, { type: "create" | "join" }>,
  ): void {
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
        touched: Date.now(),
        session: null,
      };
      this.rooms.set(code, room);
      index = 0;
    } else {
      const joinedRoom = this.rooms.get(message.code.toUpperCase());
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

  pruneInactive(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (
        !room.players.some((player) => Boolean(player?.socket)) &&
        now - room.touched > 30 * 60 * 1000
      ) {
        room.session?.close();
        this.rooms.delete(code);
      }
    }
  }

  closeAll(): void {
    for (const room of this.rooms.values()) room.session?.close();
  }
}

import { randomBytes, randomUUID } from "node:crypto";

import { WebSocket } from "ws";

import { RiichiSession } from "../../lib/riichi-session.js";
import { createGame } from "../shared/engine.js";
import {
  CHAT_HISTORY_LIMIT,
  CHAT_RATE_LIMIT_COUNT,
  CHAT_RATE_LIMIT_WINDOW_MS,
  type ChatMessage,
  type ClientMessage,
  type MatchmakeMessage,
} from "../shared/protocol.js";
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
import {
  MATCH_EVENT_SCHEMA_VERSION,
  MemoryProductStore,
  type AppendMatchEventInput,
  type MatchOutcome,
  type ProductStore,
} from "./product-store.js";
import { MatchmakingQueue, type MatchmakingTicket } from "./matchmaking.js";

export type SendMessage = (socket: ClientSocket, data: unknown) => void;

export interface RoomManagerOptions {
  sendMessage?: SendMessage;
  store?: RoomStore;
  productStore?: ProductStore;
  matchmaking?: MatchmakingQueue;
  now?: () => number;
}

export interface ClaimedRoomIdentity {
  readonly code: string;
  readonly matchId?: string;
  readonly seat: number;
}

export const send: SendMessage = (socket, data) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
};

const isSocketOpen = (socket: ClientSocket): boolean =>
  socket.readyState === WebSocket.OPEN;

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
  readonly matchmaking: MatchmakingQueue;
  readonly ready: Promise<void>;

  private readonly sendMessage: SendMessage;
  private readonly store: RoomStore;
  readonly productStore: ProductStore;
  private readonly now: () => number;
  private readonly matchmakingSockets = new Map<string, ClientSocket>();
  private readonly roomLocks = new Map<string, Promise<void>>();
  private readonly persistenceQueues = new Map<string, Promise<void>>();
  private entryLock: Promise<void> = Promise.resolve();
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: RoomManagerOptions = {}) {
    this.sendMessage = options.sendMessage ?? send;
    this.store = options.store ?? new MemoryRoomStore();
    this.productStore = options.productStore ?? new MemoryProductStore();
    this.matchmaking = options.matchmaking ?? new MatchmakingQueue();
    this.now = options.now ?? Date.now;
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    await this.store.initialize();
    await this.productStore.initialize();
    const now = this.now();
    await this.store.pruneExpired(now, []);
    const snapshots = await this.store.load(now);
    for (const snapshot of snapshots) {
      if (
        snapshot.state.game === "riichi" &&
        !("phase" in snapshot.state) &&
        !snapshot.riichi
      )
        throw new Error(`房間 ${snapshot.code} 缺少日麻 session snapshot`);
      const room = restore(snapshot);
      const previousMatchId = room.matchId;
      await this.ensureMatch(room);
      this.rooms.set(snapshot.code, room);
      if (room.matchId !== previousMatchId) await this.persistNow(room);
      if (snapshot.state.game === "riichi" && snapshot.riichi) {
        room.session = this.createRiichiSession(room, snapshot.riichi);
        room.session.pause(true);
      }
    }
  }

  private snapshot(room: Room): RoomSnapshot {
    const snapshot: RoomSnapshot = {
      code: room.code,
      mode: room.mode,
      state: structuredClone(room.state),
      players: room.players.map((player) =>
        player
          ? {
              name: player.name,
              tokenHash: player.tokenHash,
              bot: Boolean(player.bot),
              ...(player.userId === undefined ? {} : { userId: player.userId }),
            }
          : null,
      ),
      rounds: room.rounds,
      rematch: [...room.rematch],
      revision: room.revision,
      touched: room.touched,
      expiresAt: room.expiresAt,
      ...(room.matchId === undefined ? {} : { matchId: room.matchId }),
      eventSequence: room.eventSequence,
    };
    if (room.session) snapshot.riichi = room.session.snapshot();
    return snapshot;
  }

  private async ensureMatch(room: Room): Promise<void> {
    const existing = room.matchId
      ? await this.productStore.getMatch(room.matchId)
      : null;
    if (existing) {
      room.mode =
        existing.mode === "rated"
          ? "rated"
          : existing.mode === "public"
            ? "public"
            : "friend";
    } else {
      const match = await this.productStore.createMatch({
        roomCode: room.code,
        game: room.state.game,
        mode: room.mode,
        startedAt: room.touched,
      });
      room.matchId = match.id;
      room.eventSequence = 0;
      room.pendingEvents = [];
    }
    if (!Number.isSafeInteger(room.eventSequence) || room.eventSequence < 0)
      room.eventSequence = 0;
    await this.syncParticipants(room);
  }

  async syncParticipants(room: Room): Promise<void> {
    if (!room.matchId) return;
    for (const [seat, player] of room.players.entries()) {
      if (!player) continue;
      await this.productStore.addMatchParticipant({
        matchId: room.matchId,
        seat,
        userId: player.userId ?? null,
        displayName: player.name,
        bot: Boolean(player.bot),
        joinedAt: room.touched,
      });
    }
  }

  async claimPlayerIdentity(
    code: string,
    roomToken: string,
    userId: string,
  ): Promise<ClaimedRoomIdentity> {
    await this.ready;
    return this.runExclusive(code, async () => {
      const room = this.rooms.get(code);
      if (!room) throw new Error("找不到房間，請確認房間代碼");
      const seat = room.players.findIndex((player) =>
        Boolean(player && matchesRoomToken(roomToken, player.tokenHash)),
      );
      const player = seat < 0 ? undefined : room.players[seat];
      if (!player) throw new Error("房間 token 無效或已失效");
      if (player.bot) throw new Error("AI 座位不能綁定使用者身份");
      if (player.userId !== undefined && player.userId !== userId)
        throw new Error("此座位已綁定其他使用者");
      if (player.userId === userId)
        return {
          code: room.code,
          ...(room.matchId === undefined ? {} : { matchId: room.matchId }),
          seat,
        };
      if (!room.matchId) throw new Error("房間尚未建立對局");
      const match = await this.productStore.getMatch(room.matchId);
      if (!match || match.status !== "active")
        throw new Error("對局已結束，無法再綁定 guest 身份");
      await this.productStore.linkMatchParticipant(room.matchId, seat, userId);
      player.userId = userId;
      this.touch(room);
      await this.persist(room);
      return { code: room.code, matchId: room.matchId, seat };
    });
  }

  recordMatchEvent(
    room: Room,
    input: Omit<AppendMatchEventInput, "matchId" | "sequence">,
  ): void {
    if (!room.matchId) return;
    room.eventSequence += 1;
    room.pendingEvents.push({
      matchId: room.matchId,
      sequence: room.eventSequence,
      eventType: input.eventType,
      actorSeat: input.actorSeat ?? null,
      payload: structuredClone(input.payload),
      createdAt: input.createdAt ?? this.now(),
      schemaVersion: input.schemaVersion ?? MATCH_EVENT_SCHEMA_VERSION,
    });
  }

  async sendChat(
    room: Room,
    socket: ClientSocket,
    text: string,
  ): Promise<void> {
    const player = room.players.find((entry) => entry?.socket === socket);
    if (!player) throw new Error("只有房間玩家可以聊天");
    const now = this.now();
    if (
      socket.chatWindowStartedAt === 0 ||
      now - socket.chatWindowStartedAt >= CHAT_RATE_LIMIT_WINDOW_MS
    ) {
      socket.chatWindowStartedAt = now;
      socket.chatMessageCount = 0;
    }
    if (socket.chatMessageCount >= CHAT_RATE_LIMIT_COUNT)
      throw new Error("聊天室訊息過於頻繁，請稍後再試");
    socket.chatMessageCount += 1;
    if (!room.matchId) throw new Error("對局尚未建立");
    const message: ChatMessage = {
      id: randomUUID(),
      matchId: room.matchId,
      sequence: (room.chat.at(-1)?.sequence ?? 0) + 1,
      side: socket.side,
      name: player.name,
      text,
      createdAt: now,
    };
    room.chat = [...room.chat, message].slice(-CHAT_HISTORY_LIMIT);
    this.touch(room);
    await this.persist(room);
    this.broadcastChat(room, message);
  }

  async beginRematch(room: Room): Promise<void> {
    await this.completeMatchIfDone(room);
    if (room.state.game === "riichi") {
      room.session?.close();
      room.session = null;
    } else {
      room.state = createGame(room.state.game, room.state.rows);
    }
    const match = await this.productStore.createMatch({
      roomCode: room.code,
      game: room.state.game,
      mode: room.mode,
      startedAt: this.now(),
    });
    room.matchId = match.id;
    room.eventSequence = 0;
    room.pendingEvents = [];
    room.chat = [];
    await this.syncParticipants(room);
  }

  async enqueueMatchmaking(
    socket: ClientSocket,
    message: MatchmakeMessage,
  ): Promise<void> {
    this.assertOpen();
    return this.track(
      (async () => {
        await this.ready;
        await this.runEntry(async () => {
          if (socket.room) throw new Error("請先離開目前房間");
          if (socket.matchmakingTicketId)
            throw new Error("你已在公開配對佇列中");
          const userId = socket.userId;
          if (!userId) throw new Error("公開配對需要玩家身份");
          await this.assertUserAvailable(userId);
          const user = await this.productStore.getUser(userId);
          if (!user) throw new Error("玩家身份不存在");
          const rating =
            message.mode === "rated"
              ? (await this.productStore.getUserRating(userId, message.game))
                  .rating
              : null;
          if (!isSocketOpen(socket))
            throw new Error("配對連線已中斷，請重新嘗試");
          if (this.matchmaking.size >= 500)
            throw new Error("公開配對目前已滿，請稍後再試");
          const result = this.matchmaking.enqueue({
            userId,
            displayName: user.displayName,
            game: message.game,
            mode: message.mode,
            timeControl: message.timeControl,
            rating,
            createdAt: this.now(),
          });
          this.matchmakingSockets.set(result.ticket.id, socket);
          if (!result.match) {
            socket.matchmakingTicketId = result.ticket.id;
            this.sendMatchmakingStatus(socket, "waiting", result.ticket);
            return;
          }
          const opponentSocket = this.matchmakingSockets.get(result.match.id);
          try {
            await this.createMatchmadeRoom(result.ticket, result.match, socket);
          } catch (error) {
            for (const [ticket, playerSocket] of [
              [result.ticket, socket],
              [result.match, opponentSocket],
            ] as const) {
              this.matchmakingSockets.delete(ticket.id);
              if (!playerSocket) continue;
              if (playerSocket.matchmakingTicketId === ticket.id)
                playerSocket.matchmakingTicketId = null;
              this.sendMatchmakingStatus(playerSocket, "cancelled", ticket);
            }
            throw error;
          }
        });
      })(),
    );
  }

  async cancelMatchmaking(
    socket: ClientSocket,
    requestedTicket?: string,
  ): Promise<void> {
    if (this.closing) {
      this.removeMatchmakingSocket(socket);
      return;
    }
    return this.track(
      (async () => {
        await this.ready;
        await this.runEntry(() =>
          Promise.resolve().then(() => {
            const ticketId = requestedTicket ?? socket.matchmakingTicketId;
            if (!ticketId) return;
            if (ticketId !== socket.matchmakingTicketId)
              throw new Error("無法取消其他連線的配對");
            const ticket = this.matchmaking.get(ticketId);
            if (!ticket) {
              this.removeMatchmakingSocket(socket);
              return;
            }
            if (!socket.userId || ticket.userId !== socket.userId)
              throw new Error("無法取消其他玩家的配對");
            this.matchmaking.cancel(ticketId, socket.userId);
            this.removeMatchmakingSocket(socket);
            this.sendMatchmakingStatus(socket, "cancelled", ticket);
          }),
        );
      })(),
    );
  }

  private matchOutcome(room: Room): MatchOutcome | null {
    if (room.state.game === "riichi") {
      if (!room.session?.done) return null;
      const result = room.session.result;
      const winnerSeat = result?.rank?.indexOf(1) ?? -1;
      return {
        winnerSeat: winnerSeat >= 0 ? winnerSeat : null,
        reason: result?.type ?? "完成",
        ...(result?.scores ? { scores: [...result.scores] } : {}),
      };
    }
    if (room.state.winner === null) return null;
    return {
      winnerSeat:
        room.state.winner === 0 ? null : room.state.winner === 1 ? 0 : 1,
      reason: room.state.reason,
    };
  }

  private async completeMatchIfDone(room: Room): Promise<void> {
    const outcome = this.matchOutcome(room);
    if (!room.matchId || !outcome) return;
    await this.productStore.completeMatch({
      matchId: room.matchId,
      outcome,
      completedAt: this.now(),
    });
  }

  touch(room: Room): void {
    room.touched = this.now();
    room.expiresAt = room.touched + ROOM_TTL_MS;
  }

  async persist(room: Room): Promise<void> {
    if (room.state.game === "riichi") {
      await this.enqueuePersistence(room);
      return;
    }
    await this.persistNow(room);
  }

  private async persistNow(room: Room): Promise<void> {
    const pendingEvents = [...room.pendingEvents];
    for (const event of pendingEvents)
      await this.productStore.appendMatchEvent(event);
    await this.completeMatchIfDone(room);
    const snapshot = this.snapshot(room);
    room.revision = await this.store.update(snapshot, room.revision);
    room.pendingEvents.splice(0, pendingEvents.length);
  }

  private enqueuePersistence(room: Room): Promise<void> {
    const previous = this.persistenceQueues.get(room.code) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.persistNow(room));
    this.persistenceQueues.set(room.code, current);
    void current.then(
      () => {
        if (this.persistenceQueues.get(room.code) === current)
          this.persistenceQueues.delete(room.code);
      },
      () => {
        if (this.persistenceQueues.get(room.code) === current)
          this.persistenceQueues.delete(room.code);
      },
    );
    return this.track(current);
  }

  runExclusive<Value>(
    code: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    this.assertOpen();
    return this.track(this.runExclusiveUnsafe(code, operation));
  }

  private async runExclusiveUnsafe<Value>(
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
    await this.store.create(snapshot);
  }

  broadcast(room: Room): void {
    room.players.forEach((player, index) => {
      if (!player?.socket) return;
      this.sendMessage(player.socket, {
        type: "state",
        code: room.code,
        side: roomSide(room.state, index),
        mode: room.mode,
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
        chat: room.chat,
      });
    });
  }

  private broadcastChat(room: Room, message: ChatMessage): void {
    room.players.forEach((player) => {
      if (player?.socket)
        this.sendMessage(player.socket, { type: "chat", message });
    });
  }

  isReady(room: Room): boolean {
    return room.players.every((player) =>
      Boolean(player && (player.bot || player.socket)),
    );
  }

  startRiichi(room: Room): void {
    if (room.session) return;
    room.session = this.createRiichiSession(room);
    room.session.start();
  }

  private createRiichiSession(
    room: Room,
    snapshot?: Parameters<typeof RiichiSession.fromSnapshot>[0],
  ): RiichiSession {
    const options = {
      humans: room.players.flatMap((player, index) =>
        player && !player.bot ? [index] : [],
      ),
      rounds: room.rounds,
      names: room.players.map(
        (player, index) => player?.name ?? `玩家 ${String(index + 1)}`,
      ),
      onChange: () => {
        this.handleRiichiChange(room);
      },
      onError: () => {
        this.notifyRiichiError(room);
      },
    };
    return snapshot
      ? RiichiSession.fromSnapshot(snapshot, options)
      : new RiichiSession(options);
  }

  private handleRiichiChange(room: Room): void {
    const session = room.session;
    if (!session) return;
    room.state = {
      game: "riichi",
      winner: session.done
        ? (session.result?.rank?.indexOf(1) ?? -1) + 1
        : null,
      ply: session.revision,
    };
    this.recordMatchEvent(room, {
      eventType: "riichi.public",
      payload: {
        revision: session.revision,
        activeType: session.activeType,
        history: session.history.at(-1)?.label ?? null,
      },
    });
    this.touch(room);
    this.broadcast(room);
    if (session.activeType === "kaiju") return;
    void this.persist(room).catch(() => {
      session.pause(true);
      this.notifyRiichiError(room);
    });
  }

  private notifyRiichiError(room: Room): void {
    room.players.forEach((player) => {
      if (player?.socket)
        this.sendMessage(player.socket, {
          type: "error",
          message: "日麻對局暫停，請重新建立房間",
        });
    });
  }

  async detach(socket: ClientSocket): Promise<void> {
    if (socket.matchmakingTicketId) {
      await this.cancelMatchmaking(socket).catch(() => {
        this.removeMatchmakingSocket(socket);
      });
    }
    const code = socket.room;
    if (!code || this.closing) {
      socket.room = null;
      return;
    }
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
    this.assertOpen();
    return this.track(
      (async () => {
        await this.ready;
        await this.runEntry(() => this.handleEntryUnsafe(socket, message));
      })(),
    );
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
      const code = this.newRoomCode();
      room = {
        code,
        mode: message.mode ?? "friend",
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
        eventSequence: 0,
        pendingEvents: [],
        chat: [],
      };
      if (room.mode === "rated") {
        if (message.game === "riichi")
          throw new Error("日麻暫不支援 rated 對局");
        if (!socket.userId) throw new Error("競技房需要玩家身份");
      }
      await this.ensureMatch(room);
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
    if (room.mode === "rated" || room.mode === "public") {
      if (!socket.userId) throw new Error("公開對局需要玩家身份");
      if (existing?.userId && existing.userId !== socket.userId)
        throw new Error("競技房重連需要相同玩家身份");
      if (
        room.players.some(
          (player, playerIndex) =>
            playerIndex !== index && player?.userId === socket.userId,
        )
      )
        throw new Error("競技房不能與自己對戰");
    }
    if (existing?.socket && existing.socket !== socket) {
      existing.socket.room = null;
      existing.socket.close(4001, "Session replaced");
    }
    const token =
      message.type === "join" && message.token
        ? message.token
        : createRoomToken();
    const name = existing?.name ?? normalizeName(message.name, index);
    const userId = existing?.userId ?? (existing ? undefined : socket.userId);
    room.players[index] = {
      name,
      tokenHash: existing?.tokenHash ?? hashRoomToken(token),
      ...(userId === undefined ? {} : { userId }),
      socket,
      ...(existing?.bot ? { bot: true } : {}),
    };
    socket.room = room.code;
    socket.side = roomSide(room.state, index);
    this.touch(room);
    await this.syncParticipants(room);
    await this.persist(room);
    this.sendMessage(socket, {
      type: "joined",
      code: room.code,
      token,
      side: socket.side,
      mode: room.mode,
    });
    if (room.state.game === "riichi" && this.isReady(room)) {
      if (room.session) room.session.pause(false);
      else this.startRiichi(room);
    }
    this.broadcast(room);
  }

  async pruneInactive(now = this.now()): Promise<void> {
    if (this.closing) return;
    return this.track(this.pruneInactiveUnsafe(now));
  }

  private async pruneInactiveUnsafe(now: number): Promise<void> {
    await this.runEntry(async () => {
      for (const ticket of this.matchmaking.expire(now)) {
        const socket = this.matchmakingSockets.get(ticket.id);
        if (socket) {
          this.removeMatchmakingSocket(socket);
          this.sendMatchmakingStatus(socket, "expired", ticket);
        }
      }
      for (const [code] of this.rooms) {
        await this.runExclusiveUnsafe(code, async () => {
          const room = this.rooms.get(code);
          if (
            room &&
            !room.players.some((player) => Boolean(player?.socket)) &&
            now >= room.expiresAt
          ) {
            room.session?.close();
            if (room.matchId)
              await this.productStore.abortMatch({
                matchId: room.matchId,
                reason: "room_expired",
                abortedAt: now,
              });
            this.rooms.delete(code);
            await this.store.delete(code);
          }
        });
      }
      await this.store.pruneExpired(now, [...this.rooms.keys()]);
    });
  }

  closeAll(): Promise<void> {
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = this.finishClose();
    }
    return this.closePromise;
  }

  private async finishClose(): Promise<void> {
    await this.ready.catch(() => {});
    await this.waitForPendingOperations();
    for (const room of this.rooms.values()) room.session?.close();
    await this.store.close();
    await this.productStore.close();
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("伺服器正在關閉");
  }

  private async assertUserAvailable(userId: string): Promise<void> {
    for (const room of this.rooms.values()) {
      if (!room.players.some((player) => player?.userId === userId)) continue;
      if (!room.matchId) throw new Error("你已有進行中的對局");
      const match = await this.productStore.getMatch(room.matchId);
      if (match?.status === "active") throw new Error("你已有進行中的對局");
    }
  }

  private async createMatchmadeRoom(
    first: MatchmakingTicket,
    second: MatchmakingTicket,
    requester: ClientSocket,
  ): Promise<void> {
    const left =
      first.createdAt < second.createdAt ||
      (first.createdAt === second.createdAt && first.id <= second.id)
        ? first
        : second;
    const right = left === first ? second : first;
    const leftSocket = this.matchmakingSockets.get(left.id) ?? requester;
    const rightSocket = this.matchmakingSockets.get(right.id) ?? requester;
    if (
      leftSocket.room ||
      rightSocket.room ||
      !isSocketOpen(leftSocket) ||
      !isSocketOpen(rightSocket)
    )
      throw new Error("配對對手已離線，請重新嘗試");
    const code = this.newRoomCode();
    const now = this.now();
    const leftToken = createRoomToken();
    const rightToken = createRoomToken();
    const room: Room = {
      code,
      mode: left.mode === "rated" ? "rated" : "public",
      state: createGame(left.game),
      players: [
        {
          name: left.displayName,
          userId: left.userId,
          tokenHash: hashRoomToken(leftToken),
          socket: leftSocket,
        },
        {
          name: right.displayName,
          userId: right.userId,
          tokenHash: hashRoomToken(rightToken),
          socket: rightSocket,
        },
      ],
      rounds: 1,
      rematch: [],
      touched: now,
      expiresAt: now + ROOM_TTL_MS,
      revision: 0,
      session: null,
      eventSequence: 0,
      pendingEvents: [],
      chat: [],
    };
    let persisted = false;
    try {
      await this.ensureMatch(room);
      await this.createPersistentRoom(room);
      persisted = true;
      if (!isSocketOpen(leftSocket) || !isSocketOpen(rightSocket))
        throw new Error("配對對手已離線，請重新嘗試");
    } catch (error) {
      const cleanup = await Promise.allSettled([
        ...(persisted ? [this.store.delete(code)] : []),
        ...(room.matchId
          ? [
              this.productStore.abortMatch({
                matchId: room.matchId,
                reason: "matchmaking_failed",
                abortedAt: this.now(),
              }),
            ]
          : []),
      ]);
      const cleanupErrors = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason as unknown] : [],
      );
      if (cleanupErrors.length)
        throw new AggregateError(
          cleanupErrors,
          "配對失敗且清理對局資料時發生錯誤",
          { cause: error },
        );
      throw error;
    }
    this.matchmakingSockets.delete(left.id);
    this.matchmakingSockets.delete(right.id);
    leftSocket.matchmakingTicketId = null;
    rightSocket.matchmakingTicketId = null;
    this.rooms.set(code, room);
    const tokens = [leftToken, rightToken];
    for (const [index, player] of room.players.entries()) {
      if (!player?.socket) continue;
      const socket = player.socket;
      socket.room = code;
      socket.side = roomSide(room.state, index);
      this.sendMatchmakingStatus(socket, "matched", index === 0 ? left : right);
      this.sendMessage(socket, {
        type: "joined",
        code,
        token: tokens[index],
        side: socket.side,
        mode: room.mode,
      });
    }
    this.broadcast(room);
  }

  private sendMatchmakingStatus(
    socket: ClientSocket,
    status: "waiting" | "matched" | "cancelled" | "expired",
    ticket: MatchmakingTicket,
  ): void {
    this.sendMessage(socket, {
      type: "matchmaking",
      status,
      ticket: ticket.id,
      game: ticket.game,
      mode: ticket.mode,
      timeControl: ticket.timeControl,
      ...(status === "waiting" ? { expiresAt: ticket.expiresAt } : {}),
    });
  }

  private removeMatchmakingSocket(socket: ClientSocket): void {
    const ticketId = socket.matchmakingTicketId;
    if (ticketId) this.matchmakingSockets.delete(ticketId);
    socket.matchmakingTicketId = null;
  }

  private newRoomCode(): string {
    let code: string;
    do {
      code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    } while (this.rooms.has(code));
    return code;
  }

  private track<Value>(operation: Promise<Value>): Promise<Value> {
    this.pendingOperations.add(operation);
    void operation.then(
      () => this.pendingOperations.delete(operation),
      () => this.pendingOperations.delete(operation),
    );
    return operation;
  }

  private async waitForPendingOperations(): Promise<void> {
    while (this.pendingOperations.size > 0) {
      await Promise.allSettled([...this.pendingOperations]);
    }
  }
}

const restore = (snapshot: RoomSnapshot): Room => ({
  code: snapshot.code,
  mode: snapshot.mode ?? "friend",
  state: structuredClone(snapshot.state),
  players: snapshot.players.map((player) =>
    player
      ? {
          name: player.name,
          tokenHash: player.tokenHash,
          bot: player.bot,
          ...(player.userId === undefined ? {} : { userId: player.userId }),
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
  ...(snapshot.matchId === undefined ? {} : { matchId: snapshot.matchId }),
  eventSequence: snapshot.eventSequence ?? 0,
  pendingEvents: [],
  chat: [],
});

import { applyMove, scoringAction } from "../shared/engine.js";
import type { ClientMessage, PlayerSide } from "../shared/protocol.js";
import type { ClientSocket, SocketSide } from "./room-types.js";
import { send } from "./room-manager.js";
import type { RoomManager } from "./room-manager.js";
import { createRoomToken, hashRoomToken } from "./room-security.js";

const boardSide = (side: SocketSide): PlayerSide => {
  if (side === 1 || side === -1) return side;
  throw new Error("只有棋類房間可執行此操作");
};

const seatIndex = (side: SocketSide): number => {
  if (side < 1 || side > 4) throw new Error("無效日麻座位");
  return side - 1;
};

export async function handleClientMessage(
  socket: ClientSocket,
  message: ClientMessage,
  roomManager: RoomManager,
): Promise<void> {
  if (message.type === "create" || message.type === "join") {
    await roomManager.handleEntry(socket, message);
    return;
  }
  if (message.type === "leave") {
    await roomManager.detach(socket);
    send(socket, { type: "left" });
    return;
  }

  if (!socket.room) throw new Error("尚未加入房間");
  await roomManager.runExclusive(socket.room, () =>
    handleRoomMessage(socket, message, roomManager),
  );
}

async function handleRoomMessage(
  socket: ClientSocket,
  message: ClientMessage,
  roomManager: RoomManager,
): Promise<void> {
  const { rooms } = roomManager;
  if (!socket.room) throw new Error("尚未加入房間");
  const room = rooms.get(socket.room);
  if (!room) throw new Error("尚未加入房間");

  if (message.type === "riichi-start") {
    if (room.state.game !== "riichi" || socket.side !== 1 || room.session)
      throw new Error("只有房主可在開局前補入 AI");
    if (room.players.some((player) => player && !player.bot && !player.socket))
      throw new Error("請等待已加入的玩家重新連線");
    room.players = room.players.map(
      (player, index) =>
        player ?? {
          name: `AI 玩家 ${String(index + 1)}`,
          tokenHash: hashRoomToken(createRoomToken()),
          bot: true,
        },
    );
    await roomManager.syncParticipants(room);
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
    if (room.state.game === "riichi") throw new Error("日麻請使用專用操作");
    const side = boardSide(socket.side);
    if (room.state.turn !== side) throw new Error("還沒輪到你");
    if (message.ply !== room.state.ply)
      throw new Error("棋局已更新，請重新落子");
    room.state = applyMove(room.state, message.move);
    roomManager.recordMatchEvent(room, {
      eventType: "board.move",
      actorSeat: socket.side === 1 ? 0 : 1,
      payload: { ply: room.state.ply, move: message.move },
    });
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
    roomManager.recordMatchEvent(room, {
      eventType: "board.scoring",
      actorSeat: socket.side === 1 ? 0 : 1,
      payload: {
        action: message.type,
        ...(message.to === undefined ? {} : { to: message.to }),
      },
    });
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
    roomManager.recordMatchEvent(room, {
      eventType: "match.resign",
      actorSeat: socket.side === 1 ? 0 : 1,
      payload: { reason: "對手認輸" },
    });
  } else {
    if (room.state.winner === null) throw new Error("請先完成本局");
    room.rematch = [...new Set([...room.rematch, socket.side])];
    const humanCount = room.players.filter(
      (player) => player !== null && !player.bot,
    ).length;
    if (room.rematch.length === humanCount) {
      room.rematch = [];
      await roomManager.beginRematch(room);
      if (room.state.game === "riichi") roomManager.startRiichi(room);
    }
  }
  roomManager.touch(room);
  await roomManager.persist(room);
  roomManager.broadcast(room);
}

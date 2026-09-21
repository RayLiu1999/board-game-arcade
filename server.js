import { RiichiSession } from "./lib/riichi-session.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  createGame,
  applyMove,
  scoringAction,
  GAMES,
} from "./public/engine.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
export function createServer() {
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + path.sep)) throw Error();
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  const wss = new WebSocketServer({ server, maxPayload: 8192 });
  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  const broadcast = (room) =>
    room.players.forEach((p, index) => {
      if (p?.socket)
        send(p.socket, {
          type: "state",
          code: room.code,
          side: room.state.game === "riichi" ? index + 1 : index === 0 ? 1 : -1,
          state: room.session ? room.session.view(index) : room.state,
          players: room.players.map((p) =>
            p
              ? { name: p.name, online: !!p.socket || !!p.bot, bot: !!p.bot }
              : null,
          ),
          rematch: room.rematch,
        });
    });
  const ready = (room) => room.players.every((p) => p && (p.bot || p.socket));
  function startRiichi(room) {
    if (room.session) return;
    room.session = new RiichiSession({
      humans: room.players.flatMap((p, i) => (p.bot ? [] : [i])),
      rounds: room.rounds,
      names: room.players.map((p) => p.name),
      onChange: () => {
        room.state = {
          game: "riichi",
          winner: room.session.done
            ? room.session.result.rank.indexOf(1) + 1
            : null,
          ply: room.session.revision,
        };
        room.touched = Date.now();
        broadcast(room);
      },
      onError: () =>
        room.players.forEach(
          (p) =>
            p.socket &&
            send(p.socket, {
              type: "error",
              message: "日麻對局暫停，請重新建立房間",
            }),
        ),
    });
    room.session.start();
  }
  function detach(ws) {
    const room = rooms.get(ws.room);
    if (!room) return;
    const player = room.players.find((p) => p?.socket === ws);
    if (player) {
      player.socket = null;
      room.session?.pause(true);
      room.touched = Date.now();
      broadcast(room);
    }
    ws.room = null;
  }
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.on("pong", () => (ws.alive = true));
    let window = Date.now(),
      count = 0;
    ws.on("message", (raw) => {
      try {
        if (Date.now() - window > 1000) {
          window = Date.now();
          count = 0;
        }
        if (++count > 40) throw Error("操作過於頻繁");
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== "object") throw Error("無效訊息");
        if (msg.type === "create" || msg.type === "join") {
          if (ws.room) throw Error("請先離開目前房間");
          let room, index;
          if (msg.type === "create") {
            if (rooms.size >= 500) throw Error("房間已滿，請稍後再試");
            if (!GAMES[msg.game]) throw Error("未知棋種");
            let code;
            do {
              code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
            } while (rooms.has(code));
            room = {
              code,
              state: createGame(msg.game, msg.size),
              players: Array(msg.game === "riichi" ? 4 : 2).fill(null),
              rounds: [0, 1, 2].includes(msg.rounds) ? msg.rounds : 1,
              rematch: [],
              touched: Date.now(),
            };
            rooms.set(code, room);
            index = 0;
          } else {
            room = rooms.get(String(msg.code).toUpperCase());
            if (!room) throw Error("找不到房間，請確認房間代碼");
            index = room.players.findIndex(
              (p) => p && p.token && p.token === msg.token,
            );
            if (index < 0) index = room.players.findIndex((p) => !p);
            if (index < 0) throw Error("房間已滿");
          }
          const existing = room.players[index];
          if (existing?.socket && existing.socket !== ws) {
            existing.socket.room = null;
            existing.socket.close(4001, "Session replaced");
          }
          const token = existing?.token || randomBytes(24).toString("hex");
          const name =
            existing?.name ||
            String(msg.name || `玩家 ${index + 1}`)
              .trim()
              .slice(0, 20) ||
            `玩家 ${index + 1}`;
          room.players[index] = { name, token, socket: ws };
          ws.room = room.code;
          ws.side =
            room.state.game === "riichi" ? index + 1 : index === 0 ? 1 : -1;
          room.touched = Date.now();
          send(ws, { type: "joined", code: room.code, token, side: ws.side });
          if (room.state.game === "riichi" && ready(room)) {
            if (room.session) room.session.pause(false);
            else startRiichi(room);
          }
          broadcast(room);
          return;
        }
        if (msg.type === "leave") {
          detach(ws);
          send(ws, { type: "left" });
          return;
        }
        const room = rooms.get(ws.room);
        if (!room) throw Error("尚未加入房間");
        if (msg.type === "riichi-start") {
          if (room.state.game !== "riichi" || ws.side !== 1 || room.session)
            throw Error("只有房主可在開局前補入 AI");
          if (room.players.some((p) => p && !p.bot && !p.socket))
            throw Error("請等待已加入的玩家重新連線");
          room.players = room.players.map(
            (p, i) => p || { name: `AI 玩家 ${i + 1}`, bot: true },
          );
          startRiichi(room);
          return;
        }
        if (!ready(room)) throw Error("等待對手連線");
        if (msg.type === "riichi-action") {
          if (!room.session) throw Error("日麻尚未開局");
          room.session.act(ws.side - 1, msg.actionId);
          return;
        }
        if (msg.type === "move") {
          if (room.state.turn !== ws.side) throw Error("還沒輪到你");
          if (msg.ply !== room.state.ply) throw Error("棋局已更新，請重新落子");
          room.state = applyMove(room.state, msg.move || {});
        } else if (["dead", "accept", "resume"].includes(msg.type)) {
          room.state = scoringAction(room.state, msg, ws.side);
        } else if (msg.type === "resign") {
          if (room.state.game === "riichi")
            throw Error("日麻請透過返回大廳離開，對局將暫停");
          if (room.state.winner !== null) throw Error("本局已結束");
          room.state = { ...room.state, winner: -ws.side, reason: "對手認輸" };
        } else if (msg.type === "rematch") {
          if (room.state.winner === null) throw Error("請先完成本局");
          room.rematch = [...new Set([...room.rematch, ws.side])];
          if (
            room.rematch.length === room.players.filter((p) => !p.bot).length
          ) {
            room.rematch = [];
            if (room.state.game === "riichi") {
              room.session.close();
              room.session = null;
              startRiichi(room);
            } else room.state = createGame(room.state.game, room.state.rows);
          }
        } else throw Error("未知操作");
        room.touched = Date.now();
        broadcast(room);
      } catch (error) {
        send(ws, { type: "error", message: error.message });
      }
    });
    ws.on("close", () => detach(ws));
    ws.on("error", () => {});
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
    for (const [code, room] of rooms)
      if (
        !room.players.some((p) => p?.socket) &&
        Date.now() - room.touched > 30 * 60 * 1000
      ) {
        room.session?.close();
        rooms.delete(code);
      }
  }, 30000);
  timer.unref();
  server.on("close", () => {
    clearInterval(timer);
    for (const room of rooms.values()) room.session?.close();
    wss.close();
  });
  return { server, wss, rooms };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", () =>
    console.log(`棋聚已啟動：http://localhost:${port}`),
  );
}

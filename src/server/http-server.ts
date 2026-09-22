import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public",
);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const serveFile = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(root + path.sep)) throw new Error("禁止存取");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
};

export interface StaticHttpServerOptions {
  readonly api?: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<boolean>;
}

export const createStaticHttpServer = (
  options: StaticHttpServerOptions = {},
): Server =>
  createHttpServer((req, res) => {
    if (!options.api) {
      void serveFile(req, res);
      return;
    }
    void options
      .api(req, res)
      .then((handled) => {
        if (!handled) void serveFile(req, res);
      })
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({ error: "伺服器錯誤" }));
        } else {
          res.destroy();
        }
      });
  });

export const parsePort = (value: string | undefined): number => {
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 3000;
};

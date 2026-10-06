import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createSecureServer } from "node:https";
import type { Socket } from "node:net";
import { pipeline } from "node:stream/promises";
import { simulationCertificate } from "./certificate.js";
import type { Instance } from "../runtime/instance.js";

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function* chunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** A terminal HTTP proxy: requests can only reach this instance, never an upstream socket. */
export async function createSimulationProxy(instance: Instance) {
  const pem = await simulationCertificate();
  const sockets = new Set<Socket>();
  const serve =
    (secure: boolean) =>
    async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      let url = incoming.url ?? "/";
      try {
        url = new URL(
          url,
          `${secure ? "https" : "http"}://${incoming.headers.host}`,
        ).href;
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (hopByHop.has(name) || value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value])
            headers.append(name, item);
        }
        const requestChunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 32 * 1024 * 1024)
            throw new Error("Browser request exceeds 32 MiB");
          requestChunks.push(chunk);
        }
        const method = incoming.method ?? "GET";
        const response = await instance.dispatch(
          new Request(url, {
            method,
            headers,
            body: ["GET", "HEAD"].includes(method)
              ? undefined
              : Buffer.concat(requestChunks),
          }),
        );
        outgoing.statusCode = response.status;
        for (const [name, value] of response.headers) {
          // Captures contain decoded bodies. Node supplies framing for this connection.
          if (
            hopByHop.has(name) ||
            ["set-cookie", "content-encoding", "content-length"].includes(name)
          )
            continue;
          outgoing.setHeader(name, value);
        }
        const cookies = response.headers
          .getSetCookie()
          .flatMap((value) => value.split("\n"));
        if (cookies.length) outgoing.setHeader("set-cookie", cookies);
        // A reset must not serve stateful responses from the browser cache.
        outgoing.setHeader("cache-control", "no-store");
        if (response.body) await pipeline(chunks(response.body), outgoing);
        else outgoing.end();
      } catch (error) {
        if (outgoing.destroyed) return;
        await instance
          .reportFailure(url, {
            code: "HANDLER_EXCEPTION",
            message: error instanceof Error ? error.message : String(error),
          })
          .catch(() => undefined);
        if (outgoing.headersSent) outgoing.destroy();
        else {
          outgoing.writeHead(502);
          outgoing.end("Websim transport failed");
        }
      }
    };
  const plain = createServer(serve(false));
  const secure = createSecureServer(
    { key: pem.private, cert: pem.cert },
    serve(true),
  );
  const rejectUpgrade = (request: IncomingMessage, socket: Socket) => {
    void instance
      .reportFailure(request.url ?? "/", {
        code: "UNSUPPORTED_BEHAVIOR",
        message: "WebSocket simulation is not supported",
      })
      .finally(() => socket.destroy())
      .catch(() => undefined);
  };
  plain.on("upgrade", rejectUpgrade);
  secure.on("upgrade", rejectUpgrade);
  plain.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  plain.on("connect", (_request, socket, head) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.unshift(head);
    secure.emit("connection", socket);
  });
  await new Promise<void>((resolve, reject) => {
    plain.once("error", reject);
    plain.listen(0, "127.0.0.1", resolve);
  });
  const address = plain.address();
  if (!address || typeof address === "string")
    throw new Error("Proxy did not bind a port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        plain.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

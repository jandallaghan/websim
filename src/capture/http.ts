import type { WebSocketConnection } from "./websocket.js";
import { bytes, fields, value, type Field } from "./packets.js";

export interface Message {
  headers: Record<string, string>;
  body: Buffer[];
  complete: boolean;
}
export interface Exchange {
  id: string;
  protocol: "http/1.1" | "h2";
  timestamp: string;
  method: string;
  url: string;
  clientPort: string;
  request: Message;
  response: Message;
  status?: number;
}
function message(): Message {
  return { headers: Object.create(null), body: [], complete: false };
}
function addHeader(
  headers: Record<string, string>,
  name: string,
  text: string,
) {
  name = name.toLowerCase();
  headers[name] =
    headers[name] === undefined
      ? text
      : `${headers[name]}${name === "set-cookie" ? "\n" : ", "}${text}`;
}
function h1Headers(node: Field, kind: "request" | "response") {
  const headers: Record<string, string> = Object.create(null);
  for (const field of fields(node, `http.${kind}.line`)) {
    const line = field.value
      ? Buffer.from(field.value, "hex").toString("latin1")
      : (field.show ?? "");
    const colon = line.indexOf(":");
    if (colon > 0)
      addHeader(headers, line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return headers;
}

function h1Body(node: Field): Buffer {
  for (const name of ["http.chunk_data", "http.file_data", "data.data"]) {
    if (fields(node, name).length) return bytes(node, name);
  }
  return Buffer.alloc(0);
}

/** Pair HTTP/1 messages by request frame, and multiplexed HTTP/2 messages by TCP + stream ID. */
export class HttpDecoder {
  private readonly endedStreams = new Set<string>();
  readonly closedConnections = new Set<string>();
  readonly exchanges = new Map<string, Exchange>();
  readonly warnings = new Set<string>();
  readonly sockets = new Map<string, WebSocketConnection>();

  consume(packet: Field) {
    const connection = value(packet, "tcp.stream");
    if (connection && fields(packet, "tcp.flags.fin")[0]?.value === "1")
      this.closedConnections.add(connection);
    const frame = value(packet, "frame.number")!;
    const clientPort = value(packet, "tcp.srcport")!;
    const timestamp = new Date(
      Number(value(packet, "frame.time_epoch")) * 1000,
    ).toISOString();
    for (const node of fields(packet, "http")) {
      const method = value(node, "http.request.method");
      if (method) {
        const url = value(node, "http.request.full_uri");
        if (!url) {
          this.warnings.add(
            `Frame ${frame}: HTTP request has no complete URL.`,
          );
          continue;
        }
        const id = `${connection}:${frame}`;
        this.exchanges.set(id, {
          id,
          protocol: "http/1.1",
          timestamp,
          method,
          url,
          clientPort,
          request: {
            headers: h1Headers(node, "request"),
            body: [h1Body(node)],
            complete: true,
          },
          response: message(),
        });
      }
      const status = Number(value(node, "http.response.code"));
      if (!status || (status < 200 && status !== 101)) continue;
      const requestFrame = value(node, "http.request_in");
      const exchange = this.exchanges.get(`${connection}:${requestFrame}`);
      if (!exchange) {
        this.warnings.add(`Frame ${frame}: response has no captured request.`);
        continue;
      }
      exchange.status = status;
      const responseHeaders = h1Headers(node, "response");
      const bodyless =
        exchange.method === "HEAD" || [101, 204, 205, 304].includes(status);
      exchange.response = {
        headers: responseHeaders,
        body: [h1Body(node)],
        complete:
          bodyless ||
          (responseHeaders["transfer-encoding"]?.includes("chunked")
            ? fields(node, "http.chunk_size").at(-1)?.show === "0"
            : responseHeaders["content-length"] !== undefined),
      };
      if (status === 101)
        this.sockets.set(connection!, {
          url: exchange.url.replace(/^http/, "ws"),
          clientPort: exchange.clientPort,
        });
    }
    for (const node of fields(packet, "http2.stream")) {
      const stream = value(node, "http2.streamid");
      if (!stream || stream === "0") continue;
      const id = `${connection}:h2:${stream}`;
      if (value(node, "http2.type") === "5") {
        this.warnings.add(
          `Connection ${connection}: HTTP/2 server push is not imported.`,
        );
        continue;
      }
      const direction = `${id}:${clientPort}`;
      if (fields(node, "http2.flags.end_stream")[0]?.value === "1")
        this.endedStreams.add(direction);
      const headers: Record<string, string> = Object.create(null);
      for (const header of fields(node, "http2.header")) {
        const name = value(header, "http2.header.name");
        if (name)
          addHeader(headers, name, value(header, "http2.header.value") ?? "");
      }
      let exchange = this.exchanges.get(id);
      if (headers[":method"]) {
        exchange = {
          id,
          protocol: "h2",
          timestamp,
          method: headers[":method"],
          url: `${headers[":scheme"]}://${headers[":authority"]}${headers[":path"]}`,
          clientPort,
          request: message(),
          response: message(),
        };
        this.exchanges.set(id, exchange);
      }
      if (!exchange) continue;
      const target =
        clientPort === exchange.clientPort
          ? exchange.request
          : exchange.response;
      if (headers[":status"] && Number(headers[":status"]) < 200) continue;
      for (const [name, text] of Object.entries(headers))
        if (!name.startsWith(":")) addHeader(target.headers, name, text);
      if (headers[":status"]) exchange.status = Number(headers[":status"]);
      // TShark may expose both DATA fragments and the assembled entity on the final frame.
      // Prefer that complete wire representation, before content decoding.
      if (fields(node, "http2.body.reassembled.data").length) {
        target.body = [bytes(node, "http2.body.reassembled.data")];
      } else {
        for (const field of node.children.filter(
          (field) => field.name === "http2.data.data",
        )) {
          if (field.value) target.body.push(Buffer.from(field.value, "hex"));
        }
      }
      target.complete = this.endedStreams.has(direction);
      if (value(node, "http2.type") === "3")
        this.warnings.add(
          `${exchange.method} ${exchange.url}: HTTP/2 stream was reset.`,
        );
    }
    if (fields(packet, "quic").length)
      this.warnings.add(
        "QUIC traffic is present. HTTP/3 import is not supported; capture with QUIC disabled.",
      );
  }
}

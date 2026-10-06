import type { WebSocketFrame } from "./archive.js";
import { bytes, fields, value, type Field } from "./packets.js";

export interface WebSocketConnection {
  url: string;
  clientPort: string;
}

function socketPayload(node: Field): Buffer {
  if (node.value) return Buffer.from(node.value, "hex");
  // Older Wireshark versions place bytes under a text/binary child of the payload field.
  for (const child of node.children) {
    const data = socketPayload(child);
    if (data.length) return data;
  }
  return Buffer.alloc(0);
}

function nextSibling(root: Field, target: Field): Field | undefined {
  const index = root.children.indexOf(target);
  if (index !== -1) return root.children[index + 1];
  for (const child of root.children) {
    const sibling = nextSibling(child, target);
    if (sibling) return sibling;
  }
  return undefined;
}

export function decodeWebSockets(
  packet: Field,
  connections: ReadonlyMap<string, WebSocketConnection>,
  warnings: Set<string>,
): WebSocketFrame[] {
  const result: WebSocketFrame[] = [];
  for (const socket of fields(packet, "websocket")) {
    const connection = value(packet, "tcp.stream")!;
    const handshake = connections.get(connection);
    let payload: Buffer = Buffer.concat(
      fields(socket, "websocket.payload").map(socketPayload),
    );
    // Wireshark 4.2 emits binary payloads as a sibling data protocol rather than a child.
    if (!payload.length) {
      const sibling = nextSibling(packet, socket);
      if (sibling?.name === "fake-field-wrapper" || sibling?.name === "data")
        payload = bytes(sibling, "data.data");
    }
    const length = Number(
      value(socket, "websocket.payload_length_ext_64") ??
        value(socket, "websocket.payload_length_ext_16") ??
        value(socket, "websocket.payload_length"),
    );
    if (length > 0 && !payload.length) {
      warnings.add(
        `Connection ${connection}: a WebSocket frame payload could not be decoded.`,
      );
      continue;
    }
    result.push({
      connection,
      url: handshake?.url ?? null,
      timestamp: new Date(
        Number(value(packet, "frame.time_epoch")) * 1000,
      ).toISOString(),
      direction: handshake
        ? value(packet, "tcp.srcport") === handshake.clientPort
          ? "sent"
          : "received"
        : "unknown",
      opcode: Number(value(socket, "websocket.opcode")),
      final: fields(socket, "websocket.fin")[0]?.value === "1",
      compressed: (Number(value(socket, "websocket.rsv")) & 4) !== 0,
      payloadBase64: payload.toString("base64"),
    });
  }
  return result;
}

import { SaxesParser } from "saxes";
import { launch } from "./process.js";

export interface Field {
  name: string;
  show?: string;
  value?: string;
  children: Field[];
}
export function fields(node: Field, name: string): Field[] {
  return node.children.flatMap((child) =>
    child.name === name ? [child] : fields(child, name),
  );
}
export function value(node: Field, name: string): string | undefined {
  return fields(node, name)[0]?.show;
}
export function bytes(node: Field, name: string): Buffer {
  return Buffer.concat(
    fields(node, name).map((field) => Buffer.from(field.value ?? "", "hex")),
  );
}

/** Stream PDML one packet at a time; TShark owns TLS, TCP reassembly and HPACK decoding. */
export async function* packets(
  tshark: string,
  pcap: string,
  keyLog: string,
): AsyncGenerator<Field> {
  const process = launch(tshark, [
    "--only-protocols",
    "eth,vlan,null,sll,ip,ipv6,tcp,udp,tls,http,http2,websocket,quic",
    "-n",
    "-2",
    "-r",
    pcap,
    "-o",
    `tls.keylog_file:${keyLog}`,
    "-o",
    "tcp.desegment_tcp_streams:TRUE",
    "-o",
    "tls.desegment_ssl_records:TRUE",
    "-o",
    "tls.desegment_ssl_application_data:TRUE",
    "-o",
    "http.desegment_body:TRUE",
    "-o",
    "http.dechunk_body:TRUE",
    "-o",
    "http.decompress_body:FALSE",
    "-Y",
    "http or http2 or websocket or quic or tls.handshake.type == 1 or tls.record.content_type == 23 or tcp.flags.fin == 1",
    "-T",
    "pdml",
  ]);
  const parser = new SaxesParser();
  const stack: Field[] = [];
  let ready: Field[] = [];
  parser.on("opentag", (tag) => {
    if (!["packet", "proto", "field"].includes(tag.name)) return;
    const node: Field = {
      name: String(tag.attributes.name ?? tag.name),
      show: tag.attributes.show as string | undefined,
      value: tag.attributes.value as string | undefined,
      children: [],
    };
    stack.at(-1)?.children.push(node);
    stack.push(node);
  });
  parser.on("closetag", (tag) => {
    if (!["packet", "proto", "field"].includes(tag.name)) return;
    const node = stack.pop()!;
    if (tag.name === "packet") ready.push(node);
  });
  process.child.stdout.setEncoding("utf8");
  try {
    for await (const chunk of process.child.stdout) {
      parser.write(String(chunk));
      for (const packet of ready) yield packet;
      ready = [];
    }
    parser.close();
    const result = await process.exited;
    if (result.code !== 0)
      throw new Error(
        `TShark could not decode the capture: ${process.diagnostics()}`,
      );
  } finally {
    await process.stop();
  }
}

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import * as zlib from "node:zlib";
import { CaptureArchive, hashBody, type WebSocketFrame } from "./archive.js";
import { HttpDecoder } from "./http.js";
import { fields, packets, value } from "./packets.js";
import { decodeWebSockets } from "./websocket.js";
import { executable } from "./process.js";

export interface ImportOptions {
  pcap: string;
  keyLog: string;
  directory: string;
  name?: string;
  tsharkPath?: string;
  /** Limit imported HTTP exchanges to these origins; omitted means every decoded origin. */
  origins?: string[];
  redactUrl?: (url: string) => string;
  /** Scrub text before it reaches the archive. Raw packets and TLS keys remain unmodified. */
  redact?: (url: string, body: string) => string;
}
const secretHeaders = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);
function headers(input: Record<string, string>, response = false) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([name]) =>
        !secretHeaders.has(name) &&
        !(
          response &&
          ["content-encoding", "content-length", "transfer-encoding"].includes(
            name,
          )
        ),
    ),
  );
}
function decode(body: Buffer, encoding: string | undefined): Buffer {
  if (!body.length) return body;
  for (const coding of (encoding ?? "")
    .split(",")
    .map((part) => part.trim())
    .reverse()) {
    const options = { maxOutputLength: 128 * 1024 * 1024 };
    switch (coding) {
      case "":
      case "identity":
        break;
      case "gzip":
        body = zlib.gunzipSync(body, options);
        break;
      case "br":
        body = zlib.brotliDecompressSync(body, options);
        break;
      case "deflate":
        body = zlib.inflateSync(body, options);
        break;
      case "zstd":
        if (!zlib.zstdDecompressSync)
          throw new Error(
            "Zstandard responses require Node.js 22.15 or newer.",
          );
        body = zlib.zstdDecompressSync(body, options);
        break;
      default:
        throw new Error(`Unsupported content encoding: ${coding}`);
    }
  }
  return body;
}

/** Import a completed packet recording. Incomplete exchanges are diagnosed, never replayed as successes. */
export async function importCapture(
  options: ImportOptions,
): Promise<CaptureArchive> {
  const directory = resolve(options.directory);
  try {
    await access(join(directory, "manifest.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return importNew(options, directory);
  }
  throw new Error(
    `An archive already exists at ${directory}. Choose a new output directory.`,
  );
}
async function importNew(options: ImportOptions, directory: string) {
  const tshark = await executable("tshark", options.tsharkPath);
  await Promise.all([access(options.pcap), access(options.keyLog)]);
  const decoder = new HttpDecoder();
  const keyIds = new Set(
    (await readFile(options.keyLog, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/\s+/)[1]?.toLowerCase()),
  );
  const chromeConnections = new Set<string>();
  const decodedConnections = new Set<string>();
  const applicationConnections = new Set<string>();
  const websocketFrames: WebSocketFrame[] = [];
  for await (const packet of packets(
    tshark,
    resolve(options.pcap),
    resolve(options.keyLog),
  )) {
    decoder.consume(packet);
    const connectionId = value(packet, "tcp.stream");
    const random = fields(packet, "tls.handshake.random")[0]?.value;
    if (
      connectionId &&
      fields(packet, "tls.app_data").length &&
      fields(packet, "tls.record.content_type").some(
        (field) => field.show === "23",
      )
    )
      applicationConnections.add(connectionId);
    if (connectionId && random && keyIds.has(random.toLowerCase()))
      chromeConnections.add(connectionId);
    if (
      connectionId &&
      (fields(packet, "http").length || fields(packet, "http2").length)
    )
      decodedConnections.add(connectionId);
    websocketFrames.push(
      ...decodeWebSockets(packet, decoder.sockets, decoder.warnings),
    );
  }
  for (const frame of websocketFrames) {
    if (frame.url && options.redactUrl)
      frame.url = options.redactUrl(frame.url);
  }
  const archive = new CaptureArchive(directory, {
    version: 2,
    name: options.name ?? basename(directory),
    startedAt: new Date().toISOString(),
    entries: [],
    warnings: [],
    websocketFrames,
  });
  await mkdir(join(directory, "blobs"), { recursive: true, mode: 0o700 });
  for (const exchange of decoder.exchanges.values()) {
    const { request, response, method, status } = exchange;
    const url = options.redactUrl?.(exchange.url) ?? exchange.url;
    try {
      const parsed = new URL(exchange.url);
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("Unsupported request URL or tunnel.");
      if (options.origins && !options.origins.includes(parsed.origin)) continue;
      if (
        exchange.protocol === "http/1.1" &&
        !response.headers["content-length"] &&
        !response.headers["transfer-encoding"] &&
        decoder.closedConnections.has(exchange.id.split(":")[0]!)
      )
        response.complete = true;
      if (!status || !request.complete || !response.complete)
        throw new Error("Incomplete request or response; omitted from replay.");
      if (status === 101) {
        decoder.warnings.add(
          `${url}: WebSocket handshake and frames recorded as evidence; WebSocket replay is not supported.`,
        );
      }
      if (status === 304) {
        decoder.warnings.add(
          `${url}: cache revalidation has no body; capture from a fresh profile to obtain the resource.`,
        );
        continue;
      }
      let body: Buffer = Buffer.concat(response.body);
      const length = response.headers["content-length"];
      const bodyless = method === "HEAD" || [101, 204, 205].includes(status);
      if (!bodyless && length !== undefined && Number(length) !== body.length)
        throw new Error(
          `Incomplete response body: expected ${length} bytes, decoded ${body.length}.`,
        );
      body = bodyless
        ? Buffer.alloc(0)
        : decode(body, response.headers["content-encoding"]);
      const requestBytes = Buffer.concat(request.body);
      if (
        request.headers["content-length"] !== undefined &&
        Number(request.headers["content-length"]) !== requestBytes.length
      )
        throw new Error("Incomplete request body.");
      if (
        options.redact &&
        /json|text|javascript|xml/.test(response.headers["content-type"] ?? "")
      )
        body = Buffer.from(options.redact(url, body.toString()));
      const requestBody =
        options.redact &&
        /json|text|xml|x-www-form-urlencoded/.test(
          request.headers["content-type"] ?? "",
        )
          ? Buffer.from(options.redact(url, requestBytes.toString()))
          : requestBytes;
      const bodyHash = hashBody(body);
      await writeFile(join(directory, "blobs", bodyHash), body, {
        mode: 0o600,
      });
      archive.manifest.entries.push({
        id: randomUUID(),
        protocol: exchange.protocol,
        timestamp: exchange.timestamp,
        method,
        url,
        requestHeaders: headers(request.headers),
        requestBody: requestBody.length ? requestBody.toString() : null,
        requestBodyBase64: requestBody.length
          ? requestBody.toString("base64")
          : null,
        status,
        responseHeaders: headers(response.headers, true),
        bodyHash,
      });
    } catch (error) {
      decoder.warnings.add(
        `${method} ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const connection of chromeConnections) {
    if (
      applicationConnections.has(connection) &&
      !decodedConnections.has(connection)
    )
      decoder.warnings.add(
        `TLS connection ${connection} has Chrome keys but no decoded HTTP exchange (incomplete or unsupported protocol).`,
      );
  }
  archive.manifest.warnings.push(...decoder.warnings);
  if (!archive.manifest.entries.length)
    throw new Error(
      `No complete HTTP exchanges could be imported. Check the capture interface, TLS keys and browser traffic. ${archive.manifest.warnings.join("\n")}`,
    );
  archive.manifest.startedAt = archive.manifest.entries[0]!.timestamp;
  await archive.save();
  return archive;
}

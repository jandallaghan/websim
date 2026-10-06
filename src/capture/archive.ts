import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const entrySchema = z.object({
  id: z.string(),
  protocol: z.enum(["http/1.1", "h2"]),
  timestamp: z.iso.datetime(),
  method: z.string(),
  url: z.url(),
  requestHeaders: z.record(z.string(), z.string()),
  requestBody: z.string().nullable(),
  requestBodyBase64: z.string().nullable(),
  status: z.number().int().min(100).max(599),
  responseHeaders: z.record(z.string(), z.string()),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const websocketFrameSchema = z.object({
  connection: z.string(),
  url: z.string().nullable(),
  timestamp: z.iso.datetime(),
  direction: z.enum(["sent", "received", "unknown"]),
  opcode: z.number().int(),
  final: z.boolean(),
  compressed: z.boolean(),
  payloadBase64: z.string(),
});
export type WebSocketFrame = z.infer<typeof websocketFrameSchema>;
export const manifestSchema = z.object({
  version: z.literal(2),
  name: z.string(),
  startedAt: z.iso.datetime(),
  entries: z.array(entrySchema),
  warnings: z.array(z.string()),
  websocketFrames: z.array(websocketFrameSchema),
});
export type CaptureEntry = z.infer<typeof entrySchema>;
export type CaptureManifest = z.infer<typeof manifestSchema>;
export const hashBody = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");

export class CaptureArchive {
  constructor(
    readonly directory: string,
    readonly manifest: CaptureManifest,
  ) {}
  static async open(directory: string): Promise<CaptureArchive> {
    const input = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
    if (input.version !== 2)
      throw new Error(
        `Unsupported capture version ${input.version}. Record a new archive with websim capture.`,
      );
    const manifest = manifestSchema.parse(input);
    return new CaptureArchive(directory, manifest);
  }
  async body(entry: CaptureEntry): Promise<Buffer> {
    const body = await readFile(join(this.directory, "blobs", entry.bodyHash));
    if (hashBody(body) !== entry.bodyHash)
      throw new Error(`Capture body is corrupt: ${entry.bodyHash}`);
    return body;
  }
  async save(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, `manifest.${process.pid}.tmp`);
    await writeFile(temp, JSON.stringify(this.manifest, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(temp, join(this.directory, "manifest.json"));
  }
}

import { z } from "zod";
export const instanceOptionsSchema = z
  .object({
    state: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    scenario: z.string().optional(),
    time: z.iso.datetime().optional(),
    randomSeed: z.number().int().optional(),
    ttlMs: z.number().int().min(1000).max(86_400_000).optional(),
  })
  .strict();
export const wireRequestSchema = z.object({
  url: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  method: z.string().regex(/^[A-Z]+$/),
  headers: z.record(z.string(), z.string()),
  body: z.string().nullable(),
});
export type WireRequest = z.infer<typeof wireRequestSchema>;
export interface WireResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export async function encodeResponse(
  response: Response,
): Promise<WireResponse> {
  const headers = Object.fromEntries(response.headers);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies.join("\n");
  return {
    status: response.status,
    headers,
    body: Buffer.from(await response.arrayBuffer()).toString("base64"),
  };
}
export function decodeRequest(request: WireRequest): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body:
      ["GET", "HEAD"].includes(request.method) || request.body === null
        ? undefined
        : Buffer.from(request.body, "base64"),
  });
}
export const diagnosticSchema = z.object({
  url: z.url(),
  diagnostic: z.object({
    code: z.enum([
      "UNMATCHED_REQUEST",
      "AMBIGUOUS_CAPTURE",
      "HANDLER_EXCEPTION",
      "UNSUPPORTED_BEHAVIOR",
    ]),
    message: z.string().max(8192),
  }),
});

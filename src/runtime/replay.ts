import type { CaptureArchive, CaptureEntry } from "../capture/archive.js";
import { SimulationError, type ReplayPolicy } from "./types.js";

function stable(value: unknown, ignored: string[]): string {
  if (Array.isArray(value))
    return `[${value.map((item) => stable(item, ignored)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([key]) => !ignored.includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item, ignored)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function normalizeBody(
  body: Buffer | null,
  policy: ReplayPolicy,
): string | null {
  if (body === null || body.length === 0) return null;
  try {
    return `json:${stable(JSON.parse(body.toString()), policy.ignoreJsonFields ?? [])}`;
  } catch {
    return `bytes:${body.toString("base64")}`;
  }
}
function normalizeUrl(value: string, policy: ReplayPolicy): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of policy.ignoreQuery ?? []) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
type Candidate = {
  archive: CaptureArchive;
  entry: CaptureEntry;
  body: string | null;
};

/** Shared immutable request index; instance state never enters replay matching. */
export class ReplayEngine {
  private readonly index = new Map<string, Candidate[]>();
  constructor(
    archives: CaptureArchive[],
    private readonly policy: ReplayPolicy,
  ) {
    for (const archive of archives)
      for (const entry of archive.manifest.entries) {
        if (entry.status === 101 || entry.status === 304) continue;
        const key = `${entry.method} ${normalizeUrl(entry.url, policy)}`;
        const candidates = this.index.get(key) ?? [];
        candidates.push({
          archive,
          entry,
          body: normalizeBody(
            entry.requestBodyBase64 === null
              ? null
              : Buffer.from(entry.requestBodyBase64, "base64"),
            policy,
          ),
        });
        this.index.set(key, candidates);
      }
  }
  async match(
    request: Request,
  ): Promise<{ response: Response; source: string } | undefined> {
    const body = normalizeBody(
      ["GET", "HEAD"].includes(request.method)
        ? null
        : Buffer.from(await request.arrayBuffer()),
      this.policy,
    );
    const candidates =
      this.index.get(
        `${request.method} ${normalizeUrl(request.url, this.policy)}`,
      ) ?? [];
    const matches = candidates.filter(
      (candidate) =>
        candidate.body === body &&
        (this.policy.matchHeaders ?? []).every(
          (name) =>
            request.headers.get(name) ===
            (candidate.entry.requestHeaders[name.toLowerCase()] ?? null),
        ),
    );
    if (!matches.length) return;
    const variants = new Set(
      matches.map(({ entry }) =>
        stable(
          {
            status: entry.status,
            body: entry.bodyHash,
            headers: Object.fromEntries(
              Object.entries(entry.responseHeaders).filter(([key]) =>
                [
                  "content-type",
                  "location",
                  "access-control-allow-origin",
                ].includes(key),
              ),
            ),
          },
          [],
        ),
      ),
    );
    if (variants.size > 1)
      throw new SimulationError(
        "AMBIGUOUS_CAPTURE",
        `${matches.length} captures match ${request.method} ${request.url} with different responses. Add a handler or refine matching.`,
      );
    const { archive, entry } = matches[0]!;
    return {
      response: new Response(
        [101, 204, 205, 304].includes(entry.status) || request.method === "HEAD"
          ? null
          : new Uint8Array(await archive.body(entry)),
        { status: entry.status, headers: entry.responseHeaders },
      ),
      source: `capture:${archive.manifest.name}:${entry.id}`,
    };
  }
}

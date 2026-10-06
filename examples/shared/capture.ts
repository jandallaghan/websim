import type { CaptureArchive, CaptureEntry } from "../../src/capture/index.js";
import { SimulationError } from "../../src/index.js";

/** Select evidence explicitly; callers decide which recorded variation they model. */
export function exchanges(archive: CaptureArchive, pathname: string) {
  return archive.manifest.entries.filter(
    (entry) => new URL(entry.url).pathname === pathname,
  );
}

export function requireExchange(entries: CaptureEntry[], description: string) {
  const entry = entries[0];
  if (!entry) throw new Error(`Missing capture evidence: ${description}`);
  return entry;
}

export async function response(archive: CaptureArchive, entry: CaptureEntry) {
  return new Response(
    [204, 205, 304].includes(entry.status)
      ? null
      : new Uint8Array(await archive.body(entry)),
    {
      status: entry.status,
      headers: entry.responseHeaders,
    },
  );
}

/** Responsive image sizes share the captured source image; no generated replacement images. */
export function imageIndex(archive: CaptureArchive, origin: string) {
  const images = new Map<string, CaptureEntry>();
  for (const entry of archive.manifest.entries) {
    const url = new URL(entry.url);
    if (
      url.origin !== origin ||
      !entry.responseHeaders["content-type"]?.startsWith("image/") ||
      entry.status !== 200
    )
      continue;
    if (!images.has(url.pathname)) images.set(url.pathname, entry);
  }
  return images;
}

export function unsupported(message: string): never {
  throw new SimulationError("UNSUPPORTED_BEHAVIOR", message);
}

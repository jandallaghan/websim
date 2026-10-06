import { CaptureArchive } from "../capture/archive.js";

export interface InspectOptions {
  url?: string;
  entry?: string;
  warnings?: boolean;
}

/** JSON output lets an author inspect evidence without loading every response body. */
export async function inspectCapture(
  directory: string,
  options: InspectOptions,
) {
  const archive = await CaptureArchive.open(directory);
  const { manifest } = archive;
  if (options.entry) {
    const entry = manifest.entries.find((entry) => entry.id === options.entry);
    if (!entry) throw new Error(`Capture entry not found: ${options.entry}`);
    const body = await archive.body(entry);
    const text = /json|text|javascript|xml/.test(
      entry.responseHeaders["content-type"] ?? "",
    );
    return {
      ...entry,
      responseBody: {
        encoding: text ? "utf8" : "base64",
        bytes: body.length,
        content: body.toString(text ? "utf8" : "base64"),
      },
    };
  }
  if (options.warnings) return manifest.warnings;
  if (options.url !== undefined) {
    return manifest.entries
      .filter((entry) => entry.url.includes(options.url!))
      .map((entry) => ({
        id: entry.id,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        contentType: entry.responseHeaders["content-type"] ?? null,
      }));
  }
  const origins = new Map<string, number>();
  for (const entry of manifest.entries) {
    const origin = new URL(entry.url).origin;
    origins.set(origin, (origins.get(origin) ?? 0) + 1);
  }
  return {
    name: manifest.name,
    startedAt: manifest.startedAt,
    exchanges: manifest.entries.length,
    websocketFrames: manifest.websocketFrames.length,
    warnings: manifest.warnings.length,
    origins: Object.fromEntries(
      [...origins].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function printCaptureSummary(archive: CaptureArchive): void {
  const { manifest, directory } = archive;
  console.log(
    `Saved ${manifest.entries.length} HTTP exchanges and ${manifest.websocketFrames.length} WebSocket frames to ${directory}.`,
  );
  if (manifest.warnings.length) {
    console.warn(
      `${manifest.warnings.length} warnings. Review them before using this capture:\n  websim inspect ${JSON.stringify(directory)} --warnings`,
    );
  }
}

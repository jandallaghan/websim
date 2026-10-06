import { Hono } from "hono";
import type {
  CaptureArchive,
  CaptureEntry,
} from "../../../src/capture/index.js";
import type { SimulationEnv, SimulationModule } from "../../../src/index.js";
import { response } from "../../shared/capture.js";

function source(path: string) {
  const match = /^\/xdata\/images\/([^/]+)\/[^/]+\/(\d+)\.[^/]+$/.exec(path);
  return match ? `${match[1]}/${match[2]}` : path;
}

/** Booking's image CDN shards and responsive sizes refer to the same source photograph. */
export function images(archive: CaptureArchive): SimulationModule[] {
  const records = new Map<string, CaptureEntry>();
  for (const entry of archive.manifest.entries) {
    const url = new URL(entry.url);
    if (
      url.hostname.endsWith(".bstatic.com") &&
      entry.status === 200 &&
      entry.responseHeaders["content-type"]?.startsWith("image/")
    )
      if (!records.has(source(url.pathname)))
        records.set(source(url.pathname), entry);
  }
  return ["cf", "q-xx", "r-xx", "t-cf"].map((shard) => {
    const routes = new Hono<SimulationEnv>();
    routes.get("/*", (c, next) => {
      const entry = records.get(source(c.req.path));
      return entry ? response(archive, entry) : next();
    });
    return {
      name: `images-${shard}`,
      origin: `https://${shard}.bstatic.com`,
      routes,
      evidence: "inferred",
    };
  });
}

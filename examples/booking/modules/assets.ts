import { Hono } from "hono";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { response } from "../../shared/capture.js";

/** Booking's CDN varies CORS headers by Origin, including for prefetched scripts. */
export function assets(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const scripts = new Map(
    archive.manifest.entries
      .filter((entry) => {
        const url = new URL(entry.url);
        return (
          url.origin === "https://cf.bstatic.com" &&
          entry.method === "GET" &&
          entry.status === 200 &&
          url.pathname.endsWith(".js")
        );
      })
      .map((entry) => [new URL(entry.url).pathname, entry]),
  );
  routes.get("*", async (c, next) => {
    const entry = scripts.get(c.req.path);
    if (!entry) return next();
    const result = await response(archive, entry);
    // Verified against the same CDN URLs with an Origin request header.
    if (c.req.header("origin")) {
      result.headers.set("access-control-allow-origin", "*");
      result.headers.set("access-control-expose-headers", "*");
    }
    return result;
  });
  return routes;
}

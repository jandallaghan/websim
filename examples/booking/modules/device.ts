import { Hono } from "hono";
import { cors } from "hono/cors";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv, SimulationModule } from "../../../src/index.js";
import { response } from "../../shared/capture.js";

/** Retain the captured browser-verification result inside the isolated fixture. */
export function device(archive: CaptureArchive): SimulationModule[] {
  const origins = new Map<string, Hono<SimulationEnv>>();
  const registered = new Set<string>();
  for (const entry of archive.manifest.entries) {
    const url = new URL(entry.url);
    if (
      entry.method !== "POST" ||
      !(
        url.pathname.endsWith("/mp_verify") ||
        (url.hostname.endsWith(".sdk.awswaf.com") &&
          url.pathname.endsWith("/telemetry"))
      ) ||
      entry.status !== 200
    )
      continue;
    const key = `${url.origin}${url.pathname}`;
    if (registered.has(key)) continue;
    registered.add(key);
    let routes = origins.get(url.origin);
    if (!routes) {
      routes = new Hono<SimulationEnv>();
      routes.use(
        "*",
        cors({
          origin: ["https://www.booking.com", "https://secure.booking.com"],
          credentials: true,
        }),
      );
      origins.set(url.origin, routes);
    }
    routes.post(url.pathname, () => response(archive, entry));
  }
  return [...origins].map(([origin, routes]) => ({
    name: `device-${new URL(origin).hostname}`,
    origin,
    routes,
    evidence: "inferred",
  }));
}

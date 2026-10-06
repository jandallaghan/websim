import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv, SimulationModule } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  response,
  unsupported,
} from "../../shared/capture.js";

const events = z.object({ events: z.array(z.unknown()) });

export function infrastructure(archive: CaptureArchive): SimulationModule[] {
  const endpoints = [
    ["https://sink.gw.booking.com", "/v1/sink"],
    ["https://otel-gw.booking.com", "/v1/traces"],
    ["https://web-perf.booking.com", "/v1/report"],
    ["https://booking-privacy.my.onetrust.com", "/request/v1/consentreceipts"],
  ] as const;
  const modules: SimulationModule[] = endpoints.map(([origin, path]) => {
    const routes = new Hono<SimulationEnv>();
    routes.use(
      path,
      cors({ origin: "https://www.booking.com", credentials: true }),
    );
    const entry = requireExchange(
      exchanges(archive, path).filter((entry) => entry.method === "POST"),
      path,
    );
    routes.post(path, () => response(archive, entry));
    return {
      name: `telemetry-${new URL(origin).hostname}-${path}`,
      origin,
      routes,
      evidence: "observed",
    };
  });
  for (const [origin, path] of [
    ["https://www.booking.com", "/c360/v1/track"],
    ["https://c360.booking.com", "/v1/c360/multitrack/"],
    ["https://www.booking.com", "/c360-api/v1/c360/multitrack"],
    ["https://secure.booking.com", "/c360-api/v1/c360/multitrack"],
  ] as const) {
    const routes = new Hono<SimulationEnv>();
    routes.use(
      path,
      cors({ origin: "https://www.booking.com", credentials: true }),
    );
    routes.post(path, async (c) => {
      const batch = events.parse(await c.req.json());
      return path === "/c360/v1/track"
        ? c.json(batch.events.map(() => ({ status: 0, code: 8 })))
        : c.json({
            responses: batch.events.map(() => ({
              status: 1,
              code: 0,
              content: null,
            })),
          });
    });
    modules.push({
      name: `telemetry-${new URL(origin).hostname}-${path}`,
      origin,
      routes,
      evidence: "inferred",
    });
  }
  const tracking = new Hono<SimulationEnv>();
  for (const path of ["/js_tracking", "/c360-api/v1/purposes"]) {
    for (const method of ["GET", "POST"]) {
      const entry = exchanges(archive, path).find(
        (entry) => entry.method === method,
      );
      if (entry) tracking.on(method, path, () => response(archive, entry));
    }
  }
  modules.push({
    name: "tracking",
    origin: "https://www.booking.com",
    routes: tracking,
    evidence: "inferred",
  });
  for (const origin of [
    "https://www.booking.com",
    "https://secure.booking.com",
  ]) {
    const routes = new Hono<SimulationEnv>();
    for (const path of ["/squeak", "/c360-api/v1/purposes"]) {
      const entry = exchanges(archive, path).find(
        (entry) =>
          entry.method === "GET" && new URL(entry.url).origin === origin,
      );
      if (entry) routes.get(path, () => response(archive, entry));
    }
    modules.push({
      name: `page-services-${new URL(origin).hostname}`,
      origin,
      routes,
      evidence: "inferred",
    });
  }
  const property = new Hono<SimulationEnv>();
  property.post("/fragment.json", async (c) => {
    const form = new URLSearchParams(await c.req.text());
    const entry = exchanges(archive, c.req.path).find(
      (entry) =>
        new URLSearchParams(entry.requestBody ?? "").get("name") ===
        form.get("name"),
    );
    if (!entry) unsupported("Unobserved property fragment.");
    if (form.get("hotel_id") && form.get("hotel_id") !== "51451")
      unsupported("Property telemetry is limited to Est Hotel.");
    return response(archive, entry);
  });
  property.post("/log_rt_blocks_order", async (c) => {
    const form = new URLSearchParams(await c.req.text());
    if (form.get("hotel_id") !== "51451")
      unsupported("Unobserved property block order.");
    return response(
      archive,
      requireExchange(exchanges(archive, c.req.path), "room-order telemetry"),
    );
  });
  modules.push({
    name: "property-services",
    origin: "https://www.booking.com",
    routes: property,
    evidence: "inferred",
  });
  return modules;
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv, SimulationModule } from "../../../src/index.js";
import { requireExchange, response } from "../../shared/capture.js";

export function infrastructure(archive: CaptureArchive): SimulationModule[] {
  const telemetry = new Hono<SimulationEnv>();
  for (const path of [
    "/delta/dl_anderson/serverComponent.php",
    "/privacy/v1/b/b.rnc",
  ]) {
    const entry = requireExchange(
      archive.manifest.entries.filter(
        (entry) =>
          new URL(entry.url).origin === "https://tms.delta.com" &&
          new URL(entry.url).pathname === path &&
          entry.method === "GET",
      ),
      `Delta telemetry ${path}`,
    );
    telemetry.get(path, () => response(archive, entry));
  }
  const device = new Hono<SimulationEnv>();
  // These are the two device scripts actually loaded by the captured homepage.
  const paths = new Set(
    archive.manifest.entries
      .filter(
        (entry) =>
          new URL(entry.url).origin === "https://www.delta.com" &&
          entry.method === "GET" &&
          (new URL(entry.url).pathname.startsWith("/PJINf5") ||
            new URL(entry.url).pathname.startsWith("/akam/")),
      )
      .map((entry) => new URL(entry.url).pathname),
  );
  for (const path of paths) {
    const entry = requireExchange(
      archive.manifest.entries.filter(
        (entry) =>
          new URL(entry.url).pathname === path &&
          entry.method === "GET" &&
          entry.status === 200,
      ),
      path,
    );
    device.get(path, () => response(archive, entry));
  }
  const services: SimulationModule[] = [];
  for (const [origin, path, methods] of [
    ["https://pulse.delta.com", "/pc/delta/sst", ["GET", "POST"]],
    ["https://p11.techlab-cdn.com", "/collect", ["POST"]],
    [
      "https://dlt-beacon.dynatrace-managed.com",
      "/bf/dbbe1fe6-c1b9-4ef5-9063-f51ccbac76c8",
      ["POST"],
    ],
    ["https://tms.delta.com", "/error/e.gif", ["GET"]],
    ["https://usage.trackjs.com", "/usage.gif", ["GET"]],
    ["https://c.go-mpulse.net", "/api/config.json", ["GET"]],
    ["https://apps.pingone.com", "/signals/sdk/pong.css", ["GET"]],
    [
      "https://www.delta.com",
      "/content/dam/delta-tnt/homepage/card-cd/brycecanyon-ut-slc-945.webp",
      ["GET"],
    ],
  ] as const) {
    const routes = new Hono<SimulationEnv>();
    routes.use(
      path,
      cors({ origin: "https://www.delta.com", credentials: true }),
    );
    for (const method of methods) {
      const entry = requireExchange(
        archive.manifest.entries.filter(
          (entry) =>
            new URL(entry.url).origin === origin &&
            new URL(entry.url).pathname === path &&
            entry.method === method,
        ),
        path,
      );
      routes.on(method, path, () => response(archive, entry));
    }
    services.push({
      name: `service-${new URL(origin).hostname}-${path}`,
      origin,
      routes,
      evidence: "inferred",
    });
  }
  for (const path of paths) {
    const entry = archive.manifest.entries.find(
      (entry) =>
        new URL(entry.url).origin === "https://www.delta.com" &&
        new URL(entry.url).pathname === path &&
        entry.method === "POST",
    );
    if (entry) device.post(path, () => response(archive, entry));
  }
  return [
    {
      name: "telemetry",
      origin: "https://tms.delta.com",
      routes: telemetry,
      evidence: "inferred",
    },
    {
      name: "device",
      origin: "https://www.delta.com",
      routes: device,
      evidence: "inferred",
    },
    ...services,
  ];
}

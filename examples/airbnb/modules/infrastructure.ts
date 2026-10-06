import { Hono } from "hono";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv, SimulationModule } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  imageIndex,
  response,
} from "../../shared/capture.js";

export function infrastructure(
  archive: CaptureArchive,
  assets: CaptureArchive,
): SimulationModule[] {
  const media = new Hono<SimulationEnv>();
  const images = imageIndex(archive, "https://a0.muscache.com");
  media.get("/im/pictures/*", async (c, next) => {
    const entry = images.get(new URL(c.req.url).pathname);
    return entry ? response(archive, entry) : next();
  });
  const jsonAssets = assets.manifest.entries.filter(
    (entry) =>
      new URL(entry.url).origin === "https://a0.muscache.com" &&
      entry.method === "GET" &&
      entry.responseHeaders["content-type"]?.includes("application/json"),
  );
  for (const entry of jsonAssets) {
    const path = new URL(entry.url).pathname;
    media.get(path, () => response(assets, entry));
    const preflight = assets.manifest.entries.find(
      (candidate) =>
        candidate.method === "OPTIONS" &&
        new URL(candidate.url).origin === "https://a0.muscache.com" &&
        new URL(candidate.url).pathname === path,
    );
    if (preflight) media.options(path, () => response(assets, preflight));
  }
  const telemetry = new Hono<SimulationEnv>();
  for (const path of [
    "/tracking/jitney/logging/messages",
    "/tracking/airdog",
  ]) {
    const entries = exchanges(archive, path);
    const entry = requireExchange(entries, path);
    if (entries.some((item) => item.status !== 204))
      throw new Error(`Review telemetry evidence for ${path}`);
    telemetry.post(path, () => response(archive, entry));
  }
  const marketing = requireExchange(
    exchanges(archive, "/api/v2/marketing_event_tracking"),
    "marketing acknowledgement",
  );
  telemetry.post("/api/v2/marketing_event_tracking", () =>
    response(archive, marketing),
  );
  const botSignal = new Hono<SimulationEnv>();
  // The captured endpoint returns this cookie envelope. Its value is deliberately synthetic.
  botSignal.post("/js/", (c) =>
    c.json({
      status: 200,
      cookie:
        "datadome=websim; Max-Age=31536000; Domain=.airbnb.ie; Path=/; Secure; SameSite=Lax",
    }),
  );
  return [
    {
      name: "images",
      origin: "https://a0.muscache.com",
      routes: media,
      evidence: "observed",
    },
    {
      name: "telemetry",
      origin: "https://www.airbnb.ie",
      routes: telemetry,
      evidence: "observed",
    },
    {
      name: "browser-signal",
      origin: "https://d0a7e.airbnb.com",
      routes: botSignal,
      evidence: "inferred",
    },
  ];
}

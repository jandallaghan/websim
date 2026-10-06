import { Hono } from "hono";
import { cors } from "hono/cors";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv, SimulationModule } from "../../../src/index.js";
import {
  requireExchange,
  response,
  unsupported,
} from "../../shared/capture.js";

/** A fixed captured device identity for the local email sign-in fixture. */
export function device(archive: CaptureArchive): SimulationModule {
  const origin = "https://f02aa.airbnb.ie";
  const entry = requireExchange(
    archive.manifest.entries.filter(
      (entry) =>
        new URL(entry.url).origin === origin &&
        entry.method === "POST" &&
        new URL(entry.url).pathname === "/",
    ),
    "Airbnb device response",
  );
  const query = new URL(entry.url).search;
  const routes = new Hono<SimulationEnv>();
  routes.use("/", cors({ origin: "https://www.airbnb.ie", credentials: true }));
  routes.post("/", (c) => {
    if (new URL(c.req.url).search !== query)
      unsupported("Unobserved device SDK version.");
    return response(archive, entry);
  });
  return { name: "device", origin, routes, evidence: "inferred" };
}

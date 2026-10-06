import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";

const airportSchema = z.looseObject({
  AIRPORT_CODE: z.string(),
  AIRPORT_NAME: z.string(),
  CITY_NAME: z.string(),
  ALIASES: z.array(z.string()),
});

export async function airports(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const catalog = new Map<string, z.infer<typeof airportSchema>>();
  for (const entry of archive.manifest.entries) {
    if (
      !new URL(entry.url).pathname.startsWith("/getPredictiveCities/") ||
      entry.method !== "GET"
    )
      continue;
    for (const airport of z
      .array(airportSchema)
      .parse(JSON.parse((await archive.body(entry)).toString())))
      catalog.set(airport.AIRPORT_CODE, airport);
  }
  routes.use("*", cors({ origin: "https://www.delta.com", credentials: true }));
  routes.get("/getPredictiveCities/:term", (c) => {
    const term = c.req.param("term").trim().toLowerCase();
    return c.json(
      [...catalog.values()].filter(
        (airport) =>
          term &&
          [
            airport.AIRPORT_CODE,
            airport.AIRPORT_NAME,
            airport.CITY_NAME,
            ...airport.ALIASES,
          ].some((label) => label.toLowerCase().includes(term)),
      ),
    );
  });
  return routes;
}

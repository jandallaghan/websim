import { Hono } from "hono";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  response,
  unsupported,
} from "../../shared/capture.js";

const searchInput = z.object({
  airports: z.object({
    fromAirportcode: z.literal("JFK"),
    toAirportcode: z.literal("LAX"),
  }),
  selectTripType: z.literal("ROUND_TRIP"),
  dates: z.object({
    departureDate: z.literal("11/10/2026"),
    returnDate: z.literal("11/13/2026"),
    chkFlexDate: z.literal(false),
  }),
  passenger: z.literal(1),
  awardTravel: z.literal(false),
});

export function search(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const saved = requireExchange(
    exchanges(archive, "/prefill/updateSearch"),
    "search preference acknowledgement",
  );
  routes.post("/prefill/updateSearch", async (c) => {
    const input = searchInput.parse(await c.req.json());
    c.get("simulation").state.set("preferences", "search", input);
    return response(archive, saved);
  });
  routes.get("/prefill/retrieveSearch", (c) => {
    const entry = exchanges(archive, c.req.path).find(
      (entry) =>
        new URL(entry.url).searchParams.get("searchType") ===
        c.req.query("searchType"),
    );
    if (!entry) unsupported("Unobserved Delta search preference request.");
    return response(archive, entry);
  });
  return routes;
}

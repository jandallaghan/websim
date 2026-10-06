import { Hono } from "hono";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  response,
  unsupported,
} from "../../shared/capture.js";

export function documents(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const home = requireExchange(
    exchanges(archive, "/").filter(
      (entry) =>
        new URL(entry.url).hostname === "www.booking.com" &&
        entry.status === 200,
    ),
    "verified guest homepage",
  );
  routes.get("/", () => response(archive, home));
  routes.get("/searchresults.html", (c) => {
    if (
      c.req.query("dest_id") !== "-1456928" ||
      c.req.query("checkin") !== "2026-11-10" ||
      c.req.query("checkout") !== "2026-11-13" ||
      c.req.query("group_adults") !== "2"
    )
      unsupported(
        "Captured Booking.com stay: Paris, 10–13 November 2026, two adults.",
      );
    c.get("simulation").state.set("searches", "last", {
      city: "Paris",
      checkin: c.req.query("checkin"),
      checkout: c.req.query("checkout"),
      adults: 2,
    });
    return response(
      archive,
      requireExchange(exchanges(archive, c.req.path), "Paris search document"),
    );
  });
  routes.get("/hotel/fr/esthotelparis.html", (c) => {
    if (
      c.req.query("checkin") !== "2026-11-10" ||
      c.req.query("checkout") !== "2026-11-13"
    )
      unsupported("Property quote dates differ from the captured stay.");
    c.get("simulation").state.set("selection", "property", {
      hotelId: 51451,
      checkin: "2026-11-10",
      checkout: "2026-11-13",
      adults: 2,
    });
    return response(
      archive,
      requireExchange(exchanges(archive, c.req.path), "Est Hotel document"),
    );
  });
  return routes;
}

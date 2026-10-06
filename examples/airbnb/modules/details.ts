import { Hono } from "hono";
import type {
  CaptureArchive,
  CaptureEntry,
} from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { embeddedQueries } from "../embedded-queries.js";
import { stays } from "../catalog.js";
import {
  exchanges,
  requireExchange,
  response,
  unsupported,
} from "../../shared/capture.js";

/** Request fields which select a captured detail response; impression IDs do not affect it. */
const fields: Record<string, string[]> = {
  PdpEarlyFlushMetadataV2Query: ["id", "fetchImages", "photoId", "categoryTag"],
  StaysPdpSections: [
    "id",
    "pdpSectionsRequest.checkIn",
    "pdpSectionsRequest.checkOut",
    "pdpSectionsRequest.adults",
    "pdpSectionsRequest.sectionIds",
    "pdpSectionsRequest.layouts",
  ],
  StaysPdpBookItQuery: [
    "id",
    "dateRange.startDate",
    "dateRange.endDate",
    "guestCounts.numberOfAdults",
  ],
  PdpAvailabilityCalendar: [
    "request.listingId",
    "request.month",
    "request.year",
    "request.count",
  ],
  StaysPdpReviewsQuery: [
    "id",
    "pdpReviewsRequest.offset",
    "pdpReviewsRequest.sortingPreference",
  ],
  StaysPdpPoliciesQuery: [
    "id",
    "checkIn",
    "checkOut",
    "selectedCancellationPolicyId",
  ],
  SimilarListingsCarouselQuery: ["id"],
  PlaceListingPolygonQuery: ["id"],
};
function select(value: unknown, path: string): unknown {
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
const signature = (variables: unknown, paths: string[]) =>
  JSON.stringify(paths.map((path) => select(variables, path)));

export async function details(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const entries = new Map<string, CaptureEntry>();
  const embedded = new Map<string, Record<string, unknown>>();
  for (const stay of stays) {
    const document = requireExchange(
      exchanges(archive, `/rooms/${stay.id}`),
      "listing document",
    );
    for (const query of embeddedQueries(
      (await archive.body(document)).toString(),
    )) {
      const selected = fields[query.operation];
      if (selected)
        embedded.set(
          `${query.operation}:${signature(query.variables, selected)}`,
          query.data,
        );
    }
  }
  for (const entry of archive.manifest.entries) {
    const url = new URL(entry.url);
    const operation = url.pathname.split("/")[3] ?? "";
    const selected = fields[operation];
    if (!selected) continue;
    const variables: unknown =
      entry.method === "GET"
        ? JSON.parse(url.searchParams.get("variables") ?? "{}")
        : JSON.parse(entry.requestBody ?? "{}").variables;
    const key = `${url.pathname}:${signature(variables, selected)}`;
    if (!entries.has(key)) entries.set(key, entry);
  }
  routes.all("/api/v3/:operation/:hash", async (c, next) => {
    const selected = fields[c.req.param("operation")];
    if (!selected) return next();
    const variables: unknown =
      c.req.method === "GET"
        ? JSON.parse(c.req.query("variables") ?? "{}")
        : (await c.req.json()).variables;
    const entry = entries.get(
      `${c.req.path}:${signature(variables, selected)}`,
    );
    if (!entry) {
      const data = embedded.get(
        `${c.req.param("operation")}:${signature(variables, selected)}`,
      );
      if (data) return c.json({ data });
      unsupported(
        `Unobserved Airbnb detail request: ${c.req.param("operation")}`,
      );
    }
    return response(archive, entry);
  });
  const skeleton = requireExchange(
    exchanges(archive, "/rooms/sw_skeleton"),
    "listing worker skeleton",
  );
  routes.get("/rooms/sw_skeleton", () => response(archive, skeleton));
  routes.get("/rooms/:id", (c) => {
    const stay = stays.find((stay) => stay.id === c.req.param("id"));
    if (!stay) return c.notFound();
    if (
      (c.req.query("check_in") && c.req.query("check_in") !== stay.checkin) ||
      (c.req.query("check_out") && c.req.query("check_out") !== stay.checkout)
    )
      unsupported("Listing page dates differ from the captured quote.");
    c.get("simulation").state.set("selection", "stay", { ...stay });
    return response(
      archive,
      requireExchange(exchanges(archive, c.req.path), "listing document"),
    );
  });
  return routes;
}

import { Hono } from "hono";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv, SimulationModule } from "../../../src/index.js";
import { response, unsupported } from "../../shared/capture.js";

const coordinate = z.tuple([z.number(), z.number()]);
const viewport = z
  .tuple([z.tuple([coordinate, coordinate]), z.number()])
  .rest(z.unknown());
const path =
  "/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo";

export function maps(archives: CaptureArchive[]): SimulationModule[] {
  const google = new Hono<SimulationEnv>();
  const viewports = archives.flatMap((archive) =>
    archive.manifest.entries
      .filter(
        (entry) =>
          new URL(entry.url).pathname === path && entry.method === "POST",
      )
      .map((entry) => ({
        archive,
        entry,
        request: viewport.parse(JSON.parse(entry.requestBody!)),
      })),
  );
  google.post(path, async (c) => {
    const requested = viewport.parse(await c.req.json());
    const [[south, west], [north, east]] = requested[0];
    const recorded = viewports.find(({ request }) => {
      const [[s, w], [n, e]] = request[0];
      return (
        south >= s &&
        west >= w &&
        north <= n &&
        east <= e &&
        request[1] === requested[1] &&
        request[3] === requested[3] &&
        request[15] === requested[15]
      );
    });
    if (!recorded)
      unsupported("Map viewport exceeds captured geographic coverage.");
    return response(recorded.archive, recorded.entry);
  });
  const places = new Hono<SimulationEnv>();
  const locations = archives.flatMap((archive) =>
    archive.manifest.entries
      .filter(
        (entry) =>
          new URL(entry.url).pathname.startsWith(
            "/api/v3/LocationContextPlacesQuery/",
          ) && entry.method === "POST",
      )
      .map((entry) => ({
        archive,
        entry,
        variables: JSON.parse(entry.requestBody!).variables,
      })),
  );
  const locationRequest = z.object({
    input: z.object({
      clientInfos: z.object({
        stayListingBiases: z.array(z.object({ listingId: z.string() })),
      }),
    }),
  });
  places.all("/api/v3/LocationContextPlacesQuery/:hash", async (c) => {
    const variables = locationRequest.parse(
      c.req.method === "GET"
        ? JSON.parse(c.req.query("variables") ?? "{}")
        : (await c.req.json()).variables,
    );
    const ids = variables.input.clientInfos.stayListingBiases.map(
      (item) => item.listingId,
    );
    const recorded = locations.find(
      (item) =>
        new URL(item.entry.url).pathname === c.req.path &&
        ids.length > 0 &&
        ids.every((id) =>
          locationRequest
            .parse(item.variables)
            .input.clientInfos.stayListingBiases.some(
              (bias) => bias.listingId === id,
            ),
        ),
    );
    if (!recorded)
      unsupported("Location overlays are outside the captured destinations.");
    return response(recorded.archive, recorded.entry);
  });
  return [
    {
      name: "map-coverage",
      origin: "https://maps.googleapis.com",
      routes: google,
      evidence: "inferred",
    },
    {
      name: "places",
      origin: "https://www.airbnb.ie",
      routes: places,
      evidence: "observed",
    },
  ];
}

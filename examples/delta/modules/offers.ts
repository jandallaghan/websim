import { isDeepStrictEqual } from "node:util";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { exchanges, unsupported } from "../../shared/capture.js";

const offerSet = z.looseObject({
  trips: z.array(z.looseObject({ stopCnt: z.number() })),
});
const envelope = z.looseObject({
  data: z.looseObject({
    gqlSearchOffers: z.looseObject({
      gqlOffersSets: z.array(offerSet),
    }),
  }),
});
const request = z.object({
  variables: z.object({
    offerSearchCriteria: z.looseObject({
      offersCriteria: z.looseObject({
        preferences: z.looseObject({ nonStopOnly: z.boolean() }),
      }),
    }),
  }),
});
const path = "/prd/rm-offer-gql";

export async function offers(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const records = await Promise.all(
    exchanges(archive, path)
      .filter((entry) => entry.method === "POST")
      .map(async (entry) => ({
        request: request.parse(JSON.parse(entry.requestBody!)),
        payload: envelope.parse(
          JSON.parse((await archive.body(entry)).toString()),
        ),
      })),
  );
  routes.use(
    path,
    cors({ origin: "https://www.delta.com", credentials: true }),
  );
  routes.post(path, async (c) => {
    const body = request.parse(await c.req.json());
    const criteria = body.variables.offerSearchCriteria;
    const nonstop = criteria.offersCriteria.preferences.nonStopOnly;
    criteria.offersCriteria.preferences.nonStopOnly = false;
    const record = records.find((record) =>
      isDeepStrictEqual(record.request, body),
    );
    if (!record)
      unsupported(
        "Delta offers cover the captured JFK–LAX round trip, 10–13 November 2026, one adult. This fare or search combination has not been captured.",
      );
    const payload = structuredClone(record.payload);
    if (nonstop)
      payload.data.gqlSearchOffers.gqlOffersSets =
        payload.data.gqlSearchOffers.gqlOffersSets.filter((set) =>
          set.trips.every((trip) => trip.stopCnt === 0),
        );
    c.get("simulation").state.set("searches", "last", { criteria, nonstop });
    return c.json(payload);
  });
  return routes;
}

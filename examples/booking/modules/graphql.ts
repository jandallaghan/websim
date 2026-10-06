import { isDeepStrictEqual } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { response, unsupported } from "../../shared/capture.js";

const request = z.object({
  operationName: z.string(),
  variables: z.record(z.string(), z.unknown()),
});

// Only request attribution is ignored. Dates, occupancy, property IDs and filters remain significant.
function businessInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(businessInput);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "pageviewId",
              "uniquePageId",
              "rawQueryForSession",
              "clientSideRequestId",
            ].includes(key),
        )
        .map(([key, child]) => [key, businessInput(child)]),
    );
  return value;
}

const readOnly = new Set([
  "FullSearch",
  "GetAllowedProcessingActivities",
  "LoyaltyBannerDesktop",
  "CustomerMarketingQuery",
  "GlobalSchemaQuery",
  "AcidCarouselSearch",
  "MerchComponentsData",
  "MvRexWebRecPlatformPropertyCards",
  "WeekendDealsProperties",
  "ThematicTripCarousel",
  "GatingBanner",
  "wishlistsDetailForWishlistWidget",
  "GetXMSurveyCampaignByRegionId",
  "staticGoogleMapUrlBff",
  "HotelPageByPageName",
  "PropertyFaq",
  "PropertySurroundingsBlockDesktop",
  "SuggestedTopicQuestions",
  "userWishlistsForHotel",
  "lazyStaticGoogleMapUrlBff",
  "GuestVerificationEnforcementPropertyPage",
  "LocationPropertyDetails",
  "GenAICopilotEntrypoint",
  "RoomPageDesktopRDS",
]);

export async function graphql(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const records = archive.manifest.entries
    .filter(
      (entry) =>
        new URL(entry.url).pathname === "/dml/graphql" &&
        entry.method === "POST",
    )
    .map((entry) => ({
      entry,
      request: request.parse(JSON.parse(entry.requestBody!)),
    }));
  const autocomplete = records.find(
    (record) => record.request.operationName === "AutoComplete",
  );
  if (!autocomplete)
    throw new Error("Missing Booking.com autocomplete evidence");
  const suggestions = JSON.parse(
    (await archive.body(autocomplete.entry)).toString(),
  );
  const paris = suggestions.data.autoCompleteSuggestions.results.find(
    (result: { destination: { destId: string; destType: string } }) =>
      result.destination.destId === "-1456928" &&
      result.destination.destType === "CITY",
  );
  if (!paris) throw new Error("Captured autocomplete does not include Paris");

  routes.post("/dml/graphql", async (c, next) => {
    const body = request.parse(await c.req.json());
    if (body.operationName === "AutoComplete") {
      const input = z
        .object({ input: z.object({ prefixQuery: z.string() }) })
        .parse(body.variables);
      const prefix = input.input.prefixQuery.trim().toLowerCase();
      const payload = structuredClone(suggestions);
      payload.data.autoCompleteSuggestions.results =
        prefix && "paris".startsWith(prefix) ? [paris] : [];
      return c.json(payload);
    }
    if (
      [
        "trackAdStatus",
        "trackHoldoutExperiment",
        "DismissGeniusSignInSheet",
      ].includes(body.operationName)
    ) {
      const record = records.find(
        (record) => record.request.operationName === body.operationName,
      );
      if (!record) unsupported(`Missing ${body.operationName} evidence`);
      if (body.operationName === "DismissGeniusSignInSheet")
        c.get("simulation").state.set("preferences", "genius", {
          dismissed: true,
        });
      return response(archive, record.entry);
    }
    if (!readOnly.has(body.operationName)) return next();
    const record = records.find(
      (record) =>
        record.request.operationName === body.operationName &&
        isDeepStrictEqual(
          businessInput(record.request.variables),
          businessInput(body.variables),
        ),
    );
    if (!record)
      unsupported(`Unobserved Booking.com ${body.operationName} inputs.`);
    return response(archive, record.entry);
  });
  return routes;
}

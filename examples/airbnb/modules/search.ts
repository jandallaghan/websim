import { Hono } from "hono";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { stays } from "../catalog.js";
import {
  exchanges,
  requireExchange,
  unsupported,
  response,
} from "../../shared/capture.js";

const parameters = z.array(
  z.object({ filterName: z.string(), filterValues: z.array(z.string()) }),
);
const requestSchema = z.object({
  variables: z.object({
    staysSearchRequest: z.object({ rawParams: parameters }),
  }),
});
interface SearchItem {
  demandStayListing: { id: string };
  structuredDisplayPrice: { primaryLine: { price: string } };
}
interface SearchEnvelope {
  data: {
    presentation: {
      staysSearch: {
        results: {
          searchResults: SearchItem[];
          paginationInfo: { pageCursors: string[] };
          filters: {
            filterPanel: { resultCount: number; searchButtonText: string };
          };
          sectionConfiguration: {
            interleavedSections: unknown;
            pageTitleSections: {
              sections: { sectionData: { structuredTitle: string } }[];
            };
          };
        };
        mapResults: {
          mapSearchResults: SearchItem[];
          staysInViewport: { listingId: string }[];
        };
      };
    };
  };
}
const listingId = (item: SearchItem) =>
  Buffer.from(item.demandStayListing.id, "base64").toString().split(":").at(-1);

export async function search(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const templates = await Promise.all(
    archive.manifest.entries
      .filter((entry) =>
        new URL(entry.url).pathname.startsWith("/api/v3/StaysSearch/"),
      )
      .map(async (entry) => {
        const request = requestSchema.parse(JSON.parse(entry.requestBody!));
        const params = Object.fromEntries(
          request.variables.staysSearchRequest.rawParams.map((p) => [
            p.filterName,
            p.filterValues[0],
          ]),
        );
        const payload = JSON.parse(
          (await archive.body(entry)).toString(),
        ) as SearchEnvelope;
        return { path: new URL(entry.url).pathname, params, payload };
      }),
  );
  routes.post("/api/v3/StaysSearch/:hash", async (c) => {
    const request = requestSchema.parse(await c.req.json());
    const params = Object.fromEntries(
      request.variables.staysSearchRequest.rawParams.map((p) => [
        p.filterName,
        p.filterValues[0],
      ]),
    );
    const stay = stays.find(
      (stay) =>
        params.placeId === stay.placeId ||
        params.query?.toLowerCase().includes(stay.city.toLowerCase()),
    );
    if (!stay) unsupported("Airbnb dataset supports Paris and London.");
    if (
      (params.checkin && params.checkin !== stay.checkin) ||
      (params.checkout && params.checkout !== stay.checkout) ||
      (params.adults && Number(params.adults) !== stay.adults)
    )
      unsupported(
        `Captured quote for ${stay.city}: ${stay.checkin}–${stay.checkout}, ${stay.adults} adults.`,
      );
    const template = templates.find(
      (item) =>
        item.path === c.req.path &&
        item.params.query?.includes(stay.city) &&
        (item.params.flexibleCancellation === "true") ===
          (params.flexibleCancellation === "true"),
    );
    if (!template)
      unsupported("No captured evidence for this search/filter combination.");
    const supported = new Set([
      ...templates.flatMap((item) => Object.keys(item.params)),
      "priceMin",
      "priceMax",
      "priceFilterInputType",
      "priceFilterNumNights",
      "selectedFilterOrder",
      "searchMode",
      "updateSelectedFilters",
    ]);
    for (const { filterName, filterValues } of request.variables
      .staysSearchRequest.rawParams) {
      if (!supported.has(filterName) || filterValues.length !== 1)
        unsupported(`Airbnb filter is not modeled: ${filterName}`);
    }
    const variableParameters = new Set([
      "acpId",
      "query",
      "placeId",
      "checkin",
      "checkout",
      "adults",
      "priceMin",
      "priceMax",
      "selectedFilterOrder",
      "itemsPerGrid",
      "screenSize",
    ]);
    for (const [name, value] of Object.entries(params)) {
      if (variableParameters.has(name)) continue;
      if (!templates.some((record) => record.params[name] === value))
        unsupported(`Airbnb filter value is not modeled: ${name}=${value}`);
    }
    if (params.placeId && params.placeId !== stay.placeId)
      unsupported("Destination name and place ID refer to different cities.");
    if (c.req.query("currency") && c.req.query("currency") !== "EUR")
      unsupported("The captured Airbnb quotes use EUR.");
    for (const name of ["priceMin", "priceMax"]) {
      if (
        params[name] !== undefined &&
        (!Number.isFinite(Number(params[name])) || Number(params[name]) < 0)
      )
        unsupported(`Invalid ${name}: expected a non-negative amount.`);
    }
    const payload = structuredClone(template.payload);
    const { results, mapResults } = payload.data.presentation.staysSearch;
    const available =
      c
        .get("simulation")
        .state.get<{ available: boolean }>("availability", stay.id)
        ?.available ?? true;
    results.searchResults = results.searchResults.filter((item) => {
      if (!available || listingId(item) !== stay.id) return false;
      const total = Number(
        item.structuredDisplayPrice.primaryLine.price.replace(/[^\d.]/g, ""),
      );
      return (
        (!params.priceMin || total >= Number(params.priceMin)) &&
        (!params.priceMax || total <= Number(params.priceMax))
      );
    });
    const visible = new Set(results.searchResults.map(listingId));
    mapResults.mapSearchResults = mapResults.mapSearchResults.filter((item) =>
      visible.has(listingId(item)),
    );
    mapResults.staysInViewport = mapResults.staysInViewport.filter((item) =>
      visible.has(item.listingId),
    );
    results.paginationInfo.pageCursors =
      results.paginationInfo.pageCursors.slice(0, 1);
    results.filters.filterPanel.resultCount = visible.size;
    results.filters.filterPanel.searchButtonText = `Show ${visible.size} places`;
    results.sectionConfiguration.interleavedSections = null;
    for (const section of results.sectionConfiguration.pageTitleSections
      .sections)
      section.sectionData.structuredTitle = `${visible.size} ${visible.size === 1 ? "home" : "homes"} in ${stay.city}`;
    c.get("simulation").state.set("searches", "last", {
      city: stay.city,
      checkin: stay.checkin,
      checkout: stay.checkout,
      adults: stay.adults,
      listingIds: [...visible],
    });
    return c.json(payload);
  });
  const autocompletePath = "/api/v2/autocompletes-personalized";
  const autocomplete = await Promise.all(
    stays.map(async (stay) => {
      const entry = requireExchange(
        exchanges(archive, autocompletePath).filter(
          (entry) =>
            new URL(entry.url).searchParams.get("user_input") === stay.city,
        ),
        `${stay.city} autocomplete`,
      );
      const payload = JSON.parse((await archive.body(entry)).toString()) as {
        autocomplete_terms: { display_name: string }[];
      };
      payload.autocomplete_terms = payload.autocomplete_terms.filter((term) =>
        term.display_name.startsWith(stay.city + ","),
      );
      return { stay, payload };
    }),
  );
  routes.get(autocompletePath, (c) => {
    const input = (c.req.query("user_input") ?? "").trim().toLowerCase();
    const match = autocomplete.find(
      ({ stay }) =>
        stay.city.toLowerCase().startsWith(input) ||
        input.startsWith(stay.city.toLowerCase()),
    );
    if (!match)
      unsupported("Airbnb destination dataset supports Paris and London.");
    return c.json(match.payload);
  });
  routes.get("/api/v3/AutoSuggestionsQuery/:hash", (c) =>
    response(
      archive,
      requireExchange(
        exchanges(archive, c.req.path),
        "destination suggestions",
      ),
    ),
  );
  routes.get("/api/v3/HeatmapQuery/:hash", (c) => {
    const variables = c.req.query("variables") ?? "";
    const stay = stays.find((stay) => variables.includes(stay.placeId));
    if (!stay) unsupported("Unsupported destination calendar");
    return response(
      archive,
      requireExchange(
        exchanges(archive, c.req.path).filter((entry) =>
          new URL(entry.url).searchParams
            .get("variables")
            ?.includes(stay.placeId),
        ),
        "destination calendar",
      ),
    );
  });
  return routes;
}

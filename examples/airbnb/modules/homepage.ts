import { isDeepStrictEqual } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { embeddedQueries } from "../embedded-queries.js";
import { requireExchange, unsupported } from "../../shared/capture.js";

const page = z.looseObject({
  presentation: z.looseObject({
    homepage: z.looseObject({
      tabbedVerticalHomepage: z.looseObject({
        feedSections: z.looseObject({
          compact: z.array(z.unknown()),
          wide: z.array(z.unknown()),
          sections: z.array(z.unknown()),
        }),
        paginationInfo: z.looseObject({
          nextPageCursor: z.string().nullable(),
        }),
      }),
    }),
  }),
});

/** The local homepage inventory ends after the sections embedded in its document. */
export async function homepage(archive: CaptureArchive) {
  const document = requireExchange(
    archive.manifest.entries.filter(
      (entry) =>
        new URL(entry.url).pathname === "/" &&
        entry.responseHeaders["content-type"]?.includes("text/html"),
    ),
    "Airbnb homepage",
  );
  const query = embeddedQueries((await archive.body(document)).toString()).find(
    (query) => query.operation === "TabbedVerticalHomepage",
  );
  if (!query) throw new Error("Missing homepage hydration data");
  const template = page.parse(query.data);
  const nextCursor =
    template.presentation.homepage.tabbedVerticalHomepage.paginationInfo
      .nextPageCursor;
  const routes = new Hono<SimulationEnv>();
  routes.post("/api/v3/TabbedVerticalHomepage/:hash", async (c) => {
    const request = z
      .object({
        variables: z.looseObject({
          cursor: z.string().optional(),
          federatedSearchSessionId: z.string().optional(),
        }),
      })
      .parse(await c.req.json());
    const {
      cursor,
      federatedSearchSessionId: _session,
      ...variables
    } = request.variables;
    if (
      !isDeepStrictEqual(variables, query.variables) ||
      (cursor && cursor !== nextCursor)
    )
      unsupported(
        "This homepage covers the captured accommodation recommendations only.",
      );
    const data = structuredClone(template);
    const homepage = data.presentation.homepage.tabbedVerticalHomepage;
    if (cursor) {
      homepage.feedSections.compact = [];
      homepage.feedSections.wide = [];
      homepage.feedSections.sections = [];
    }
    homepage.paginationInfo.nextPageCursor = null;
    return c.json({ data });
  });
  return routes;
}

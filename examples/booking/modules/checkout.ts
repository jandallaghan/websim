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

const selection = z.object({
  propertyPagePayload: z.object({
    search: z.object({
      checkin: z.literal("2026-11-10"),
      checkout: z.literal("2026-11-13"),
      numberOfAdults: z.literal(2),
      childrenAges: z.array(z.never()).length(0),
    }),
    offer: z.object({
      hotelId: z.literal(51451),
      blockId: z.literal("5145105_410119458_2_2_0"),
      channelId: z.literal(3),
      propertyCountryCode: z.literal("fr"),
    }),
  }),
});
const basketInput = z.object({
  input: z.object({
    creator: z.literal("ACCOMMODATION"),
    basketItems: z.tuple([
      z.object({
        productType: z.literal("ACCOMMODATION"),
        funnelPayload: z.string(),
      }),
    ]),
  }),
});

export function checkout(archive: CaptureArchive) {
  const baskets = new Hono<SimulationEnv>();
  baskets.post("/dml/graphql", async (c, next) => {
    const body = await c.req.json<{
      operationName: string;
      variables: unknown;
    }>();
    if (body.operationName !== "CreateBasketV3") return next();
    const input = basketInput.parse(body.variables);
    const item = selection.parse(
      JSON.parse(input.input.basketItems[0].funnelPayload),
    );
    const { state, id } = c.get("simulation");
    const basketId = id();
    state.set("baskets", basketId, {
      ...item.propertyPagePayload,
      stage: "selected",
    });
    return c.json({
      data: { createBasketV3: { basketId, __typename: "GQLBasket" } },
    });
  });
  const documents = new Hono<SimulationEnv>();
  const guest = requireExchange(
    exchanges(archive, "/book.html").filter(
      (entry) =>
        entry.status === 200 &&
        !new URL(entry.url).searchParams.has("auth_success"),
    ),
    "guest booking details",
  );
  documents.get("/book.html", (c) => {
    const basketId = c.req.query("basket_id");
    const { state } = c.get("simulation");
    const basket =
      basketId && state.get<Record<string, unknown>>("baskets", basketId);
    if (
      (basketId && !basket) ||
      c.req.query("stage") !== "1" ||
      c.req.query("hotel_id") !== "51451" ||
      c.req.query("checkin") !== "2026-11-10" ||
      c.req.query("interval") !== "3"
    )
      unsupported(
        "Select the captured Est Hotel room before opening guest details.",
      );
    // The captured property form also supports direct submission without the optional basket API.
    const selectedRooms = Object.entries(c.req.query()).filter(
      ([key, value]) => key.startsWith("nr_rooms_") && value !== "0",
    );
    if (
      c.req.query("room1") !== "A,A" ||
      selectedRooms.length !== 1 ||
      selectedRooms[0]?.[0] !== "nr_rooms_5145105_410119458_2_2_0" ||
      selectedRooms[0]?.[1] !== "1"
    )
      unsupported("The captured quote is for one twin room and two adults.");
    state.set("baskets", basketId ?? "native", {
      ...basket,
      hotelId: 51451,
      blockId: "5145105_410119458_2_2_0",
      checkin: "2026-11-10",
      checkout: "2026-11-13",
      adults: 2,
      stage: "guest-details",
    });
    return response(archive, guest);
  });
  return { baskets, documents };
}

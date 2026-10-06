import { isDeepStrictEqual } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  unsupported,
  response,
} from "../../shared/capture.js";

const selection = z.looseObject({ cacheKey: z.string() });
const cartRequest = z.object({
  cartId: z.string(),
  amountOffPerPassenger: z.literal(""),
  currencyCode: z.literal(""),
  milesOffPerPassenger: z.literal(""),
  offerId: z.literal(""),
});
const cartResponse = z.looseObject({ cartId: z.string() });

export async function checkout(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const selected = requireExchange(
    exchanges(archive, "/shop/rt/search"),
    "selected Delta itinerary",
  );
  const recordedInput = selection.parse(JSON.parse(selected.requestBody!));
  const selectedPayload = cartResponse.parse(
    JSON.parse((await archive.body(selected)).toString()),
  );
  const cart = requireExchange(
    exchanges(archive, "/checkout/retrievecart"),
    "Delta guest cart",
  );
  const cartPayload = cartResponse.parse(
    JSON.parse((await archive.body(cart)).toString()),
  );
  // Cart references are opaque backend identifiers; each instance issues its own.
  const withCart = (payload: typeof cartPayload, id: string) =>
    JSON.parse(JSON.stringify(payload).replaceAll(payload.cartId, id));
  routes.post("/shop/rt/search", async (c) => {
    const input = selection.parse(await c.req.json());
    if (
      !isDeepStrictEqual(
        { ...input, cacheKey: "" },
        { ...recordedInput, cacheKey: "" },
      )
    )
      unsupported(
        "Checkout covers DL742 outbound and DL979 return, Main Classic, for the captured dates and one adult.",
      );
    const { state, id } = c.get("simulation");
    const cartId = id();
    state.set("carts", cartId, { selection: input, stage: "selected" });
    return c.json(withCart(selectedPayload, cartId));
  });
  const document = requireExchange(
    exchanges(archive, "/completepurchase/trip-summary"),
    "Delta trip summary document",
  );
  routes.get("/completepurchase/:step", (c, next) => {
    if (!["trip-summary", "review-pay"].includes(c.req.param("step")))
      return next();
    const cartId = c.req.query("cartId");
    if (!cartId || !c.get("simulation").state.get("carts", cartId))
      unsupported(
        "Select an itinerary in this instance before opening trip review.",
      );
    return response(archive, document);
  });
  routes.post("/checkout/retrievecart", async (c) => {
    const input = cartRequest.parse(await c.req.json());
    const state = c.get("simulation").state;
    const cart = state.get<Record<string, unknown>>("carts", input.cartId);
    if (!cart)
      unsupported(
        "Select an itinerary in this instance before opening the cart.",
      );
    state.set("carts", input.cartId, { ...cart, stage: "review" });
    return c.json(withCart(cartPayload, input.cartId));
  });
  for (const path of [
    "/checkout/checkCustLoginInfo",
    "/checkout/populatePassengers",
    "/checkout/tripTotalForAllPax",
    "/checkout/loyaltyMileageInfo",
    "/baggage/allowances",
  ]) {
    const entry = requireExchange(exchanges(archive, path), path);
    const expected =
      entry.method === "GET"
        ? Object.fromEntries(new URL(entry.url).searchParams)
        : JSON.parse(entry.requestBody!);
    const payload = JSON.parse((await archive.body(entry)).toString());
    routes.on(entry.method, path, async (c) => {
      const input = entry.method === "GET" ? c.req.query() : await c.req.json();
      const cartId = z.string().parse(input.cartId);
      if (!c.get("simulation").state.get("carts", cartId))
        unsupported("This cart does not exist in this instance.");
      if (
        !isDeepStrictEqual(
          { ...input, cartId: "" },
          { ...expected, cartId: "" },
        )
      )
        unsupported(`Unobserved cart request: ${path}`);
      return c.json(
        JSON.parse(JSON.stringify(payload).replaceAll(expected.cartId, cartId)),
      );
    });
  }
  const insurance = requireExchange(
    exchanges(archive, "/merchandize/insurance/search"),
    "insurance offer",
  );
  const insuranceInput = z
    .object({ requester: z.record(z.string(), z.string()) })
    .parse(JSON.parse(insurance.requestBody!));
  routes.post("/merchandize/insurance/search", async (c) => {
    const input = z
      .object({ requester: z.record(z.string(), z.string()) })
      .parse(await c.req.json());
    const cartId = input.requester.cartId;
    if (
      !cartId ||
      !c.get("simulation").state.get("carts", cartId) ||
      !isDeepStrictEqual(
        { ...input.requester, cartId: "" },
        { ...insuranceInput.requester, cartId: "" },
      )
    )
      unsupported("Unobserved insurance quote request.");
    return response(archive, insurance);
  });
  return routes;
}

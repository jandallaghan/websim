import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { requireExchange, unsupported } from "../../shared/capture.js";
import { stays } from "../catalog.js";

const request = z.object({
  input: z.object({
    productId: z.string(),
    checkinDate: z.string(),
    checkoutDate: z.string(),
    guestCurrencyOverride: z.enum(["EUR"]).nullable(),
    guestCounts: z.object({
      numberOfAdults: z.number(),
      numberOfChildren: z.literal(0),
      numberOfInfants: z.literal(0),
      numberOfPets: z.literal(0),
    }),
    businessTravel: z.object({ workTrip: z.literal(false) }),
    addOn: z.object({
      carbonOffsetParams: z.object({ isSelected: z.literal(false) }),
      guestDonationParams: z.object({ isSelected: z.literal(false) }),
    }),
  }),
});

/** Keep quote references consistent without exposing captured payment capabilities. */
function localTokens(
  value: unknown,
  tokens = new Map<string, string>(),
): unknown {
  if (Array.isArray(value))
    return value.map((item) => localTokens(item, tokens));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (/token$/i.test(key) && typeof child === "string") {
        if (!tokens.has(child))
          tokens.set(child, `websim-quote-${tokens.size + 1}`);
        return [key, tokens.get(child)];
      }
      return [key, localTokens(child, tokens)];
    }),
  );
}

export async function checkout(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const records = await Promise.all(
    archive.manifest.entries
      .filter((entry) =>
        new URL(entry.url).pathname.startsWith("/api/v3/stayCheckout/"),
      )
      .map(async (entry) => ({
        method: entry.method,
        payload: localTokens(
          JSON.parse((await archive.body(entry)).toString()),
        ) as Record<string, unknown>,
      })),
  );
  routes.all("/api/v3/stayCheckout/:hash", async (c) => {
    const session = getCookie(c, "websim_session");
    const { state } = c.get("simulation");
    if (!session || !state.get("sessions", session))
      unsupported("Sign in with the local email flow before checkout.");
    const variables =
      c.req.method === "GET"
        ? JSON.parse(c.req.query("variables") ?? "{}")
        : (await c.req.json()).variables;
    const { input } = request.parse(variables);
    const id = Buffer.from(input.productId, "base64")
      .toString()
      .split(":")
      .at(-1);
    const stay = stays.find((stay) => stay.id === id);
    if (
      !stay ||
      stay.city !== "Paris" ||
      stay.checkin !== input.checkinDate ||
      stay.checkout !== input.checkoutDate ||
      stay.adults !== input.guestCounts.numberOfAdults
    )
      unsupported(
        "Booking review is captured for the Paris stay, 10–13 November, two adults.",
      );
    if (
      state.get<{ available: boolean }>("availability", stay.id)?.available ===
      false
    )
      unsupported(
        "The scenario has no availability; a sold-out checkout response has not been captured.",
      );
    const record = records.find((record) => record.method === c.req.method);
    if (!record) unsupported("This checkout method has not been captured.");
    state.set("checkout", "current", {
      listingId: stay.id,
      checkin: stay.checkin,
      checkout: stay.checkout,
      adults: stay.adults,
      stage: "review",
    });
    return c.json(record.payload);
  });
  const consent = requireExchange(
    archive.manifest.entries.filter((entry) =>
      new URL(entry.url).pathname.includes("/JPMessagingConsentCheckQuery/"),
    ),
    "messaging consent check",
  );
  const consentPayload = JSON.parse((await archive.body(consent)).toString());
  routes.get("/api/v3/JPMessagingConsentCheckQuery/:hash", (c) =>
    c.json(consentPayload),
  );
  return routes;
}

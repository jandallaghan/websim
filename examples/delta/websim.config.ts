import { fileURLToPath } from "node:url";
import { CaptureArchive } from "../../src/capture/index.js";
import { defineSimulation } from "../../src/index.js";

import { authentication } from "./modules/authentication.js";
import { checkout } from "./modules/checkout.js";
import { search } from "./modules/search.js";
import { infrastructure } from "./modules/infrastructure.js";
import { airports } from "./modules/airports.js";
import { offers } from "./modules/offers.js";

export default async function simulation() {
  const capture = await CaptureArchive.open(
    fileURLToPath(new URL("./captures/session", import.meta.url)),
  );
  return defineSimulation({
    name: "Delta",
    description: "JFK–LAX fares, itinerary selection, and pre-payment review.",
    entrypoint: "https://www.delta.com/eu/en",
    captures: [capture],
    modules: [
      {
        name: "authentication",
        origin: "https://signin.delta.com",
        routes: await authentication(capture),
        evidence: "inferred",
      },
      {
        name: "checkout",
        origin: "https://www.delta.com",
        routes: await checkout(capture),
        evidence: "inferred",
      },
      {
        name: "search",
        origin: "https://www.delta.com",
        routes: search(capture),
        evidence: "inferred",
      },
      ...infrastructure(capture),
      {
        name: "airports",
        origin: "https://predictivesearch-api.delta.com",
        routes: await airports(capture),
        evidence: "inferred",
      },
      {
        name: "offers",
        origin: "https://offer-api-prd.delta.com",
        routes: await offers(capture),
        evidence: "inferred",
      },
    ],
    scenarios: { guest: { description: "Signed out" } },
    defaultScenario: "guest",
  });
}

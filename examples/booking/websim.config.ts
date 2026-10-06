import { fileURLToPath } from "node:url";
import { CaptureArchive } from "../../src/capture/index.js";
import { defineSimulation } from "../../src/index.js";

import { assets } from "./modules/assets.js";
import { device } from "./modules/device.js";
import { checkout } from "./modules/checkout.js";
import { images } from "./modules/images.js";
import { infrastructure } from "./modules/infrastructure.js";
import { graphql } from "./modules/graphql.js";
import { documents } from "./modules/documents.js";

export default async function simulation() {
  const capture = await CaptureArchive.open(
    fileURLToPath(new URL("./captures/session", import.meta.url)),
  );
  const booking = checkout(capture);
  return defineSimulation({
    name: "Booking.com",
    description: "Paris search, Est Hotel room selection, and guest details.",
    entrypoint: "https://www.booking.com/",
    captures: [capture],
    modules: [
      {
        name: "assets",
        origin: "https://cf.bstatic.com",
        routes: assets(capture),
        evidence: "inferred",
      },
      {
        name: "baskets",
        origin: "https://www.booking.com",
        routes: booking.baskets,
        evidence: "inferred",
      },
      {
        name: "guest-details",
        origin: "https://secure.booking.com",
        routes: booking.documents,
        evidence: "observed",
      },
      ...infrastructure(capture),
      ...device(capture),
      ...images(capture),
      {
        name: "graphql",
        origin: "https://www.booking.com",
        routes: await graphql(capture),
        evidence: "inferred",
      },
      {
        name: "documents",
        origin: "https://www.booking.com",
        routes: documents(capture),
        evidence: "observed",
      },
    ],
    scenarios: { guest: { description: "Signed out" } },
    defaultScenario: "guest",
  });
}

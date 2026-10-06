import { fileURLToPath } from "node:url";
import { defineSimulation } from "../../src/index.js";
import { CaptureArchive } from "../../src/capture/index.js";

import { infrastructure } from "./modules/infrastructure.js";
import { authentication } from "./modules/authentication.js";
import { checkout } from "./modules/checkout.js";
import { profile } from "./modules/profile.js";
import { device } from "./modules/device.js";
import { maps } from "./modules/maps.js";
import { details } from "./modules/details.js";
import { search } from "./modules/search.js";
import { stays } from "./catalog.js";
import { homepage } from "./modules/homepage.js";
import { bootstrap } from "./modules/bootstrap.js";

export default async function simulation() {
  const capture = await CaptureArchive.open(
    fileURLToPath(new URL("./captures/session", import.meta.url)),
  );
  const auth = await CaptureArchive.open(
    fileURLToPath(new URL("./captures/auth", import.meta.url)),
  );
  const assetHosts = new Set([
    "a0.muscache.com",
    "f02aa.airbnb.ie",
    "accounts.google.com",
    "appleid.cdn-apple.com",
    "x.klarnacdn.net",
    "cdn.jsdelivr.net",
  ]);
  const authAssets = new CaptureArchive(auth.directory, {
    ...auth.manifest,
    entries: auth.manifest.entries.filter(
      (entry) =>
        entry.method === "GET" && assetHosts.has(new URL(entry.url).hostname),
    ),
  });
  const searchCapture = await CaptureArchive.open(
    fileURLToPath(new URL("./captures/search", import.meta.url)),
  );
  const recordedUrls = new Set(
    [...capture.manifest.entries, ...authAssets.manifest.entries].map(
      (entry) => entry.url,
    ),
  );
  const additionalAssets = new CaptureArchive(searchCapture.directory, {
    ...searchCapture.manifest,
    entries: searchCapture.manifest.entries.filter(
      (entry) =>
        !recordedUrls.has(entry.url) &&
        !new URL(entry.url).pathname.startsWith("/api/"),
    ),
  });
  return defineSimulation({
    name: "Airbnb",
    description:
      "Paris and London stays; local email sign-in and booking review.",
    entrypoint: "https://www.airbnb.ie/?locale=en",
    captures: [capture, authAssets, additionalAssets],
    modules: [
      {
        name: "homepage",
        origin: "https://www.airbnb.ie",
        routes: await homepage(capture),
        evidence: "inferred",
      },
      {
        name: "authentication",
        origin: "https://www.airbnb.ie",
        routes: await authentication(auth),
        evidence: "inferred",
      },
      ...infrastructure(capture, auth),
      device(auth),
      {
        name: "checkout",
        origin: "https://www.airbnb.ie",
        routes: await checkout(auth),
        evidence: "inferred",
      },
      {
        name: "profile",
        origin: "https://www.airbnb.ie",
        routes: await profile(auth),
        evidence: "inferred",
      },
      ...maps([capture, searchCapture]),
      {
        name: "details",
        origin: "https://www.airbnb.ie",
        routes: await details(capture),
        evidence: "observed",
      },
      {
        name: "search",
        origin: "https://www.airbnb.ie",
        routes: await search(capture),
        evidence: "inferred",
      },
      {
        name: "bootstrap",
        origin: "https://www.airbnb.ie",
        routes: bootstrap(capture, auth),
        evidence: "observed",
      },
    ],
    scenarios: {
      guest: { description: "Paris and London captured stays, signed out." },
      "sold-out": {
        description: "The captured stays are unavailable.",
        initialize({ state }) {
          for (const stay of stays)
            state.set("availability", stay.id, { available: false });
        },
      },
    },
    defaultScenario: "guest",
  });
}

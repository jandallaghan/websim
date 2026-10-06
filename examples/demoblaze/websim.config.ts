import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { defineSimulation, type SimulationEnv } from "../../src/index.js";
import { CaptureArchive } from "../../src/capture/index.js";
import { readProducts, catalogRoutes } from "./modules/catalog.js";
import { authRoutes } from "./modules/auth.js";
import { cartRoutes } from "./modules/cart.js";

const archive = await CaptureArchive.open(
  fileURLToPath(new URL("./captures/store", import.meta.url)),
);
const products = await readProducts(archive);
const media = new Hono<SimulationEnv>();
// Video playback is outside this example's scope. A finite empty playlist prevents background retries.
media.get("/*.m3u8", (c) =>
  c.text(
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-ENDLIST\n",
    200,
    { "content-type": "application/vnd.apple.mpegurl" },
  ),
);
export default defineSimulation({
  name: "Demoblaze Store",
  description:
    "The real storefront, captured locally. Browse products, sign in, and manage a cart in independent worlds.",
  entrypoint: "https://www.demoblaze.com/",
  captures: [archive],
  replay: { ignoreQuery: ["idp_"] },
  modules: [
    {
      name: "catalog",
      origin: "https://api.demoblaze.com",
      routes: catalogRoutes(products),
      evidence: "observed",
    },
    {
      name: "authentication",
      origin: "https://api.demoblaze.com",
      routes: authRoutes(),
      evidence: "inferred",
    },
    {
      name: "cart",
      origin: "https://api.demoblaze.com",
      routes: cartRoutes(products),
      evidence: "inferred",
    },
    {
      name: "media-boundary",
      origin: "https://hls.demoblaze.com",
      routes: media,
      evidence: "authored",
    },
  ],
  seeds: {
    empty: {
      description: "An empty cart. Log in with demo / websim.",
      apply({ state }) {
        state.set("users", "demo", { username: "demo", password: "websim" });
      },
    },
    "saved-cart": {
      description:
        "The demo user already has a Samsung Galaxy S6 in their cart.",
      apply({ state }) {
        state.set("users", "demo", { username: "demo", password: "websim" });
        state.set("cart", "saved-phone", {
          id: "saved-phone",
          cookie: "demo",
          prod_id: 1,
        });
      },
    },
  },
  defaultSeed: "empty",
});

import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { defineSimulation, type SimulationEnv } from "../../../src/index.js";
import { accounts } from "./accounts.js";
const site = new Hono<SimulationEnv>();
const html = await readFile(new URL("./site.html", import.meta.url), "utf8");
site.get("/", (c) => c.html(html));
site.get("/favicon.ico", (c) => c.body(null, 204));
export default defineSimulation({
  name: "Account test fixture",
  description: "Owned fixture for state and browser lifecycle tests.",
  entrypoint: "https://north.example/",
  modules: [
    { name: "website", origin: "https://north.example", routes: site },
    { name: "accounts", origin: "https://north.example", routes: accounts },
  ],
  seeds: {
    funded: {
      description: "A personal account with £100 and no transactions.",
      apply: ({ state }) => state.set("accounts", "main", { balance: 10000 }),
    },
    empty: {
      description: "A new personal account with a zero balance.",
      apply: ({ state }) => state.set("accounts", "main", { balance: 0 }),
    },
  },
  defaultSeed: "funded",
});

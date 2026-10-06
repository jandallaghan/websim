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
  scenarios: {
    "deposit-retry": {
      description: "The first deposit fails without changing the balance.",
      behavior: { depositFailures: 1 },
      initialize: ({ state }) =>
        state.set("accounts", "main", { balance: 2500 }),
    },
    funded: {
      description: "A personal account with £100 and no transactions.",
      initialize: ({ state }) =>
        state.set("accounts", "main", { balance: 10000 }),
    },
    empty: {
      description: "A new personal account with a zero balance.",
      initialize: ({ state }) => state.set("accounts", "main", { balance: 0 }),
    },
  },
  defaultScenario: "funded",
});

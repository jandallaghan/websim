import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { defineSimulation, type SimulationEnv } from "../src/index.js";
import { CaptureArchive } from "../src/capture/index.js";

export const bankHtml = `<!doctype html><html><head><title>North Bank</title></head><body><h1>North Bank</h1><p>Balance: <output aria-label="Balance"></output></p><form><label>Deposit in cents <input name="amount" type="number"></label><button>Deposit</button></form><p role="status" aria-label="Deposit result"></p><script>
async function balance() { const result = await fetch('/account'); const data = await result.json(); document.querySelector('output').textContent = data.balance; }
document.querySelector('form').onsubmit = async e => { e.preventDefault(); const response = await fetch('/deposit', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ amount: Number(document.querySelector('input').value) }) }); const data = await response.json(); document.querySelector('[role=status]').textContent = data.error || 'Deposit complete'; await balance(); }; balance();</script></body></html>`;
export async function startBank() {
  let visited!: () => void;
  const visit = new Promise<void>((resolve) => {
    visited = resolve;
  });
  const app = new Hono();
  app.get("/", (c) => c.html(bankHtml));
  app.get("/account", (c) => {
    setTimeout(visited, 100);
    return c.json({ balance: 10000 });
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    visited: visit,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
export function banking(origin: string, archive?: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  routes.get("/account", (c) =>
    c.json(c.get("simulation").state.get("accounts", "main")),
  );
  routes.post("/deposit", async (c) => {
    const { amount } = await c.req.json();
    if (!Number.isSafeInteger(amount) || amount <= 0)
      return c.json({ error: "Enter a positive amount" }, 400);
    const { state } = c.get("simulation");
    const balance = state.transaction(() => {
      const account = state.get<{ balance: number }>("accounts", "main")!;
      account.balance += amount;
      state.set("accounts", "main", account);
      return account.balance;
    });
    return c.json({ balance });
  });
  return defineSimulation({
    name: "North Bank",
    description: "A test-owned bank with deposits.",
    entrypoint: `${origin}/`,
    modules: [{ name: "accounts", origin, routes }],
    captures: archive ? [archive] : [],
    seeds: {
      funded: {
        description: "An account with £100",
        apply: ({ state }) => state.set("accounts", "main", { balance: 10000 }),
      },
      empty: {
        description: "An account with £0",
        apply: ({ state }) => state.set("accounts", "main", { balance: 0 }),
      },
    },
    defaultSeed: "funded",
  });
}

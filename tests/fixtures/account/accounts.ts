import { Hono } from "hono";
import { z } from "zod";
import type { SimulationEnv } from "../../../src/index.js";
export interface Account {
  balance: number;
}
export const accounts = new Hono<SimulationEnv>();
accounts.get("/api/account", (c) =>
  c.json(c.get("simulation").state.get<Account>("accounts", "main")),
);
accounts.get("/api/transactions", (c) =>
  c.json(c.get("simulation").state.list("transactions")),
);
accounts.post("/api/deposits", async (c) => {
  const input = z
    .object({ amount: z.number().int().positive().max(1_000_000) })
    .safeParse(await c.req.json());
  if (!input.success)
    return c.json({ error: "Enter an amount between £0.01 and £10,000." }, 400);
  const { state, id, clock } = c.get("simulation");
  const account = state.transaction(() => {
    const account = state.get<Account>("accounts", "main")!;
    const transactionId = id();
    account.balance += input.data.amount;
    state.set("accounts", "main", account);
    state.set("transactions", transactionId, {
      id: transactionId,
      amount: input.data.amount,
      date: clock.now().toISOString(),
    });
    return account;
  });
  return c.json(account);
});

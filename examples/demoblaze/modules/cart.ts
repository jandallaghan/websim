import { Hono } from "hono";
import { z } from "zod";
import type { SimulationEnv, StateStore } from "../../../src/index.js";
import type { Product } from "./catalog.js";
interface CartItem {
  id: string;
  cookie: string;
  prod_id: number;
}
function owner(
  state: StateStore,
  cookie: string,
  flag: boolean,
): string | undefined {
  if (flag)
    return state.get<{ username: string }>("sessions", cookie)?.username;
  return cookie.match(/(?:^|;\s*)user=([^;]+)/)?.[1] ?? cookie;
}
export function cartRoutes(products: Product[]): Hono<SimulationEnv> {
  const app = new Hono<SimulationEnv>();
  const identity = z.object({
    cookie: z.string().min(1),
    flag: z.boolean().default(false),
  });
  app.post("/addtocart", async (c) => {
    const parsed = identity
      .extend({ id: z.string().min(1), prod_id: z.number().int() })
      .safeParse(await c.req.json());
    if (!parsed.success)
      return c.json(
        { errorMessage: "Bad parameter, missing cart fields." },
        400,
      );
    const { state } = c.get("simulation");
    const input = parsed.data;
    const user = owner(state, input.cookie, input.flag);
    if (!user) return c.json({ errorMessage: "Token has expired" });
    if (!products.some((product) => product.id === input.prod_id))
      return c.json({ errorMessage: "Product does not exist." }, 404);
    state.set("cart", input.id, {
      id: input.id,
      cookie: user,
      prod_id: input.prod_id,
    });
    return c.json("");
  });
  app.post("/viewcart", async (c) => {
    const parsed = identity.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json(
        { errorMessage: "Bad parameter, missing cart fields." },
        400,
      );
    const { state } = c.get("simulation");
    const user = owner(state, parsed.data.cookie, parsed.data.flag);
    if (!user) return c.json({ errorMessage: "Token has expired" });
    return c.json({
      Items: state
        .list<CartItem>("cart")
        .filter((item) => item.cookie === user),
    });
  });
  app.post("/deleteitem", async (c) => {
    const { id } = await c.req.json();
    c.get("simulation").state.delete("cart", String(id));
    return c.json("");
  });
  app.post("/deletecart", async (c) => {
    const { cookie } = await c.req.json();
    const { state, id, clock } = c.get("simulation");
    // The captured frontend calls deletecart at checkout; its confirmation is generated client-side.
    const user =
      state.get<{ username: string }>("sessions", String(cookie))?.username ??
      owner(state, String(cookie), false);
    state.transaction(() => {
      const items = state
        .list<CartItem>("cart")
        .filter((item) => item.cookie === user);
      if (items.length) {
        const orderId = id();
        state.set("orders", orderId, {
          id: orderId,
          owner: user,
          items,
          createdAt: clock.now().toISOString(),
        });
      }
      for (const item of items) state.delete("cart", item.id);
    });
    return c.json("");
  });
  return app;
}

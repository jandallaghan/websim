import { Hono } from "hono";
import { z } from "zod";
import type { SimulationEnv } from "../../../src/index.js";
export interface User {
  username: string;
  password: string;
}
const credentials = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export function authRoutes(): Hono<SimulationEnv> {
  const app = new Hono<SimulationEnv>();
  app.post("/login", async (c) => {
    const input = credentials.safeParse(await c.req.json());
    if (!input.success)
      return c.json(
        { errorMessage: "Please fill out Username and Password." },
        400,
      );
    const { state, id } = c.get("simulation");
    const user = state.get<User>("users", input.data.username);
    if (!user) return c.json({ errorMessage: "User does not exist." });
    if (input.data.password !== Buffer.from(user.password).toString("base64"))
      return c.json({ errorMessage: "Wrong password." });
    const token = id();
    state.set("sessions", token, { username: user.username });
    return c.json(`Auth_token: ${token}`);
  });
  app.post("/check", async (c) => {
    const { token } = await c.req.json();
    const session = c
      .get("simulation")
      .state.get<{ username: string }>("sessions", String(token));
    return c.json(
      session ? { Item: session } : { errorMessage: "Token has expired" },
    );
  });
  app.post("/signup", async (c) => {
    const input = credentials.safeParse(await c.req.json());
    if (!input.success)
      return c.json(
        { errorMessage: "Please fill out Username and Password." },
        400,
      );
    const { state } = c.get("simulation");
    if (state.get("users", input.data.username))
      return c.json({ errorMessage: "This user already exist." });
    state.set("users", input.data.username, {
      username: input.data.username,
      password: Buffer.from(input.data.password, "base64").toString(),
    });
    return c.json("");
  });
  return app;
}

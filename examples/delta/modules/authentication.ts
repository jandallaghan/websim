import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  unsupported,
} from "../../shared/capture.js";

const challenge = z.looseObject({
  id: z.string(),
  _links: z.record(z.string(), z.object({ href: z.string() })),
});

/** Only initiation was observed. Credential and CAPTCHA outcomes remain unsupported. */
export async function authentication(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  routes.use("*", cors({ origin: "https://www.delta.com", credentials: true }));
  const entry = requireExchange(
    exchanges(archive, "/as/authorization.oauth2").filter(
      (entry) => entry.method === "GET",
    ),
    "Delta sign-in initiation",
  );
  const template = challenge.parse(
    JSON.parse((await archive.body(entry)).toString()),
  );
  routes.get("/as/authorization.oauth2", (c) => {
    if (
      c.req.query("client_id") !== "deltacom" ||
      c.req.query("response_type") !== "code" ||
      c.req.query("code_challenge_method") !== "S256"
    )
      unsupported("Unobserved Delta sign-in client or authorization method.");
    const { state, id } = c.get("simulation");
    const flowId = id();
    const payload = structuredClone(template);
    for (const link of Object.values(payload._links))
      link.href = link.href.replace(template.id, flowId);
    payload.id = flowId;
    state.set("authentication", flowId, { stage: "identifier-required" });
    return c.json(payload);
  });
  routes.post("/pf-ws/authn/flows/:id", () =>
    unsupported(
      "Delta credential and CAPTCHA outcomes have not been captured. This simulation supports guest checkout only.",
    ),
  );
  return routes;
}

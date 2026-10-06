import type { Browser } from "playwright";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { RemoteBrowser, browserAction } from "./remote-browser.js";
import { InstanceManager } from "../runtime/manager.js";
import type { SimulationDefinition } from "../runtime/types.js";
import {
  decodeRequest,
  encodeResponse,
  instanceOptionsSchema,
  wireRequestSchema,
  diagnosticSchema,
} from "./protocol.js";
import { WebsimClient } from "../sdk/client.js";

export interface ServerOptions {
  port?: number;
  token?: string;
  /** The runner owns the browser; manual sessions own only their contexts. */
  browser?: Browser;
  sandbox?: { browserPath: string };
}
export interface WebsimServer {
  url: string;
  token: string;
  close(): Promise<void>;
}
export async function startServer(
  definition: SimulationDefinition,
  options: ServerOptions = {},
): Promise<WebsimServer> {
  const token = options.token ?? randomBytes(32).toString("hex");

  const app = new Hono();
  const browsers = new Map<string, Promise<RemoteBrowser>>();
  const closeBrowsers = async (id: string): Promise<void> => {
    const browser = browsers.get(id);
    browsers.delete(id);
    if (browser) await (await browser.catch(() => undefined))?.close();
  };
  const manager = new InstanceManager(definition, closeBrowsers);
  let url = "";
  app.use("*", bodyLimit({ maxSize: 32 * 1024 * 1024 }));
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && origin !== `http://${c.req.header("host")}`)
      return c.json(
        { error: "Cross-origin management requests are not allowed" },
        403,
      );
    const supplied = Buffer.from(
      c.req.header("authorization")?.replace(/^Bearer /, "") ?? "",
    );
    const expected = Buffer.from(token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return c.json({ error: "Unauthorized" }, 401);
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 400));
  app.get("/api/sandbox", (c) =>
    options.sandbox
      ? c.json({ ...options.sandbox, network: "none" })
      : c.json({ error: "This server is not a sandbox" }, 404),
  );
  app.get("/api/simulation", (c) =>
    c.json({
      name: definition.name,
      description: definition.description,
      entrypoint: definition.entrypoint,
      defaultScenario: definition.defaultScenario,
      scenarios: Object.entries(definition.scenarios).map(
        ([name, scenario]) => ({
          name,
          description: scenario.description,
        }),
      ),
      modules: definition.modules.map(({ name, origin, evidence }) => ({
        name,
        origin,
        evidence: evidence ?? "authored",
      })),
      captures: (definition.captures ?? []).map(({ manifest }) => ({
        name: manifest.name,
        entries: manifest.entries.length,
        warnings: manifest.warnings,
        startedAt: manifest.startedAt,
      })),
    }),
  );
  app.get("/api/instances", (c) =>
    c.json(manager.list().map((instance) => instance.info())),
  );
  app.post("/api/instances", async (c) =>
    c.json(
      manager.create(instanceOptionsSchema.parse(await c.req.json())).info(),
      201,
    ),
  );
  app.use("/api/instances/:id/*", async (c, next) => {
    if (!manager.get(c.req.param("id")!))
      return c.json({ error: "Instance not found" }, 404);
    await next();
  });
  app.get("/api/instances/:id", async (c) => {
    const instance = manager.get(c.req.param("id"));
    return instance
      ? c.json(await instance.inspect())
      : c.json({ error: "Instance not found" }, 404);
  });
  app.delete("/api/instances/:id", async (c) => {
    await manager.remove(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/api/instances/:id/reset", async (c) => {
    await closeBrowsers(c.req.param("id"));
    await manager.get(c.req.param("id"))!.reset();
    return c.body(null, 204);
  });
  app.post("/api/instances/:id/dispatch", async (c) =>
    c.json(
      await encodeResponse(
        await manager
          .get(c.req.param("id"))!
          .dispatch(decodeRequest(wireRequestSchema.parse(await c.req.json()))),
      ),
    ),
  );
  app.post("/api/instances/:id/diagnostics", async (c) => {
    const input = diagnosticSchema.parse(await c.req.json());
    await manager
      .get(c.req.param("id"))!
      .reportFailure(input.url, input.diagnostic);
    return c.body(null, 204);
  });
  app.post("/api/instances/:id/open", async (c) => {
    if (!options.browser)
      return c.json(
        {
          error:
            "Browser launch is disabled on this server. Connect using the SDK.",
        },
        403,
      );
    const id = c.req.param("id");
    if (!browsers.has(id)) {
      const remote = RemoteBrowser.open(
        options.browser,
        new WebsimClient({ url, token }).instance(id),
        definition.entrypoint,
      );
      browsers.set(id, remote);
      remote.catch(() => {
        if (browsers.get(id) === remote) browsers.delete(id);
      });
    }
    await browsers.get(id);
    return c.json({ opened: true });
  });
  app.get("/api/instances/:id/browser", async (c) => {
    const browser = browsers.get(c.req.param("id"));
    return browser
      ? c.json(await (await browser).frame())
      : c.json({ error: "Open the browser first" }, 404);
  });
  app.post("/api/instances/:id/browser", async (c) => {
    const browser = browsers.get(c.req.param("id"));
    if (!browser) return c.json({ error: "Open the browser first" }, 404);
    await (await browser).act(browserAction.parse(await c.req.json()));
    return c.body(null, 204);
  });
  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: options.port ?? 0,
  });
  await new Promise<void>((resolve, reject) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine server address");
  url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    token,
    async close() {
      await Promise.all([...browsers.keys()].map(closeBrowsers));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await manager.close();
    },
  };
}

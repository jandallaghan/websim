import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import { startSandbox } from "../sandbox/index.js";
import { discoverSimulations } from "./catalog.js";

type Runner = Awaited<ReturnType<typeof startSandbox>>;
export interface WorkspaceOptions {
  directory?: string;
  projectRoot?: string;
  image?: string;
  port?: number;
}

/** Host-side catalog and control API. Configurations execute only in isolated runners. */
export async function startWorkspace(options: WorkspaceOptions = {}) {
  const directory = resolve(options.directory ?? ".");
  const projectRoot = resolve(options.projectRoot ?? ".");
  const runners = new Map<string, Promise<Runner>>();
  let closing = false;
  async function catalog() {
    return discoverSimulations(directory, projectRoot);
  }
  async function runner(id: string) {
    if (closing) throw new Error("Workspace is stopping.");
    const entry = (await catalog()).find((entry) => entry.id === id);
    if (!entry) throw new Error("Simulation not found.");
    let pending = runners.get(id);
    if (!pending) {
      pending = startSandbox({ image: options.image, config: entry.config });
      runners.set(id, pending);
      const current = pending;
      pending.catch(() => {
        if (runners.get(id) === current) runners.delete(id);
      });
    }
    return pending;
  }
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 32 * 1024 * 1024 }));
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && origin !== `http://${c.req.header("host")}`)
      return c.json(
        { error: "Cross-origin management requests are not allowed" },
        403,
      );
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 400));
  app.get("/api/workspace", async (c) =>
    c.json({
      name: basename(directory),
      simulations: (await catalog()).map((entry) => ({
        ...entry,
        running: runners.has(entry.id),
      })),
    }),
  );
  app.get("/api/simulations/:id/connection", async (c) => {
    const active = await runner(c.req.param("id"));
    return c.json({
      url: active.url,
      token: active.token,
      browserEndpoint: active.browserEndpoint,
    });
  });
  app.delete("/api/simulations/:id/runner", async (c) => {
    const id = c.req.param("id");
    const pending = runners.get(id);
    // Keep the entry until teardown finishes so no second runner can race cleanup.
    if (pending) {
      await (await pending).close();
      if (runners.get(id) === pending) runners.delete(id);
    }
    return c.body(null, 204);
  });
  app.all("/api/simulations/:id/*", async (c) => {
    const active = await runner(c.req.param("id"));
    const prefix = `/api/simulations/${c.req.param("id")}`;
    const suffix = c.req.path.slice(prefix.length);
    const headers = new Headers({ authorization: `Bearer ${active.token}` });
    const contentType = c.req.header("content-type");
    if (contentType) headers.set("content-type", contentType);
    const response = await fetch(
      `${active.url}/api${suffix}${new URL(c.req.url).search}`,
      {
        method: c.req.method,
        headers,
        body: ["GET", "HEAD"].includes(c.req.method)
          ? undefined
          : await c.req.arrayBuffer(),
        signal: AbortSignal.timeout(40_000),
      },
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  });
  const root = fileURLToPath(new URL("../../dist/ui/", import.meta.url));
  app.get("/", (c) => c.redirect("/ui/"));
  app.use(
    "/ui/*",
    serveStatic({
      root,
      rewriteRequestPath: (path) =>
        path.replace(/^\/ui\/?/, "") || "index.html",
    }),
  );
  await catalog();
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
    throw new Error("Workspace did not bind.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      closing = true;
      const results = await Promise.allSettled(
        [...runners.values()].map(async (pending) => (await pending).close()),
      );
      runners.clear();
      if ("closeAllConnections" in server) server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (errors.length)
        throw new AggregateError(errors, "Could not stop all runners.");
    },
  };
}

import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
} from "playwright";
import type { InstanceHandle } from "./client.js";

export interface BrowserSession {
  context: BrowserContext;
  close(): Promise<void>;
}
/** Preserve original origins and cookies, while fulfilling every HTTP request through Websim. */
export async function createBrowserSession(
  browser: Browser,
  instance: InstanceHandle,
  options: Omit<BrowserContextOptions, "serviceWorkers"> = {},
): Promise<BrowserSession> {
  const context = await browser.newContext({
    ...options,
    serviceWorkers: "block",
  });
  const errors: Error[] = [];
  const reports: Promise<void>[] = [];
  await context.route("**/*", async (route) => {
    try {
      const request = route.request();
      const response = await instance.dispatch({
        url: request.url(),
        method: request.method(),
        headers: await request.allHeaders(),
        body: request.postDataBuffer()?.toString("base64") ?? null,
      });
      const headers = { ...response.headers };
      delete headers["content-length"];
      delete headers["transfer-encoding"];
      delete headers["content-encoding"];
      await route.fulfill({
        status: response.status,
        headers,
        body: Buffer.from(response.body, "base64"),
      });
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
      await route.abort().catch(() => undefined);
    }
  });
  await context.routeWebSocket("**/*", (socket) => {
    errors.push(
      new Error(`WebSocket simulation is not supported: ${socket.url()}`),
    );
    reports.push(
      instance
        .reportFailure(socket.url(), {
          code: "UNSUPPORTED_BEHAVIOR",
          message: `WebSocket simulation is not supported: ${socket.url()}`,
        })
        .catch((error) => {
          errors.push(error);
        }),
    );
    socket.close();
  });
  return {
    context,
    async close() {
      await context.close();
      await Promise.all(reports);
      if (errors.length)
        throw new AggregateError(errors, "Browser transport failed");
      await instance.assertHealthy();
    },
  };
}

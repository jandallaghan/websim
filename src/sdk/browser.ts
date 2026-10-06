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
/** Preserve original origins and cookies, while serving HTTP through the instance proxy. */
export async function createBrowserSession(
  browser: Browser,
  instance: InstanceHandle,
  options: Omit<
    BrowserContextOptions,
    "serviceWorkers" | "proxy" | "ignoreHTTPSErrors"
  > = {},
): Promise<BrowserSession> {
  const proxy = await instance.browserProxy();
  const context = await browser.newContext({
    ...options,
    serviceWorkers: "allow",
    proxy: { server: proxy.url, bypass: "<-loopback>" },
    // The terminal proxy presents an ephemeral certificate for captured HTTPS origins.
    ignoreHTTPSErrors: true,
  });
  await context.clock.setSystemTime(proxy.time);
  const errors: Error[] = [];
  const reports: Promise<void>[] = [];
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

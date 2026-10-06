import { test as base, expect } from "@playwright/test";
import {
  WebsimClient,
  type ClientOptions,
  type InstanceHandle,
} from "./sdk/client.js";
import { createBrowserSession } from "./sdk/browser.js";
import type { InstanceOptions } from "./runtime/types.js";

/** Each test owns an instance and browser context; teardown detects swallowed simulation failures. */
export const test = base.extend<{
  websim: InstanceHandle;
  websimOptions: InstanceOptions;
  websimServer: ClientOptions;
}>({
  websimServer: [
    {
      url: process.env.WEBSIM_URL ?? "http://127.0.0.1:4100",
      token: process.env.WEBSIM_TOKEN ?? "",
    },
    { option: true },
  ],
  websimOptions: [{}, { option: true }],
  connectOptions: [
    async ({}, use) => {
      const wsEndpoint = process.env.WEBSIM_BROWSER_ENDPOINT;
      if (!wsEndpoint)
        throw new Error(
          "Set WEBSIM_BROWSER_ENDPOINT from websim dev, or provide connectOptions.wsEndpoint for your sandbox.",
        );
      await use({ wsEndpoint });
    },
    { scope: "worker" },
  ],
  websim: async ({ websimServer, websimOptions }, use) => {
    const instance = await new WebsimClient(websimServer).createInstance(
      websimOptions,
    );
    try {
      await use(instance);
      await instance.assertHealthy();
    } finally {
      await instance.dispose();
    }
  },
  context: async ({ browser, websim, contextOptions }, use) => {
    const session = await createBrowserSession(browser, websim, contextOptions);
    try {
      await use(session.context);
    } finally {
      await session.close();
    }
  },
});
export { expect };

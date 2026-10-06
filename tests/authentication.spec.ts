import { test, expect } from "@playwright/test";
import {
  startSandbox,
  WebsimClient,
  createBrowserSession,
} from "../src/index.js";

test("cross-origin sign-in survives redirects and popups, isolates cookies, and resets", async () => {
  const sandbox = await startSandbox({
    config: "tests/fixtures/identity/websim.config.ts",
  });
  try {
    const client = new WebsimClient(sandbox);
    const first = await client.createInstance();
    const second = await client.createInstance();
    const browser = await sandbox.connectBrowser();
    try {
      const alice = await createBrowserSession(browser, first);
      const bob = await createBrowserSession(browser, second);
      const a = await alice.context.newPage();
      const b = await bob.context.newPage();
      await Promise.all([
        a.goto("https://travel.example/"),
        b.goto("https://travel.example/"),
      ]);
      await a.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller)
          await new Promise<void>((resolve) =>
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              () => resolve(),
              { once: true },
            ),
          );
      });
      const popupReady = a.waitForEvent("popup");
      await a.getByRole("link", { name: "Sign in", exact: true }).click();
      const popup = await popupReady;
      await expect(popup.getByRole("heading")).toHaveText("Verify your email");
      expect(new URL(popup.url()).origin).toBe("https://identity.example");
      await popup.getByLabel("Code").fill("000000");
      await popup.getByRole("button", { name: "Continue" }).click();
      await expect(popup.locator("body")).toHaveText("Invalid code");
      await first.assertHealthy();
      await popup.goBack();
      await popup.getByLabel("Code").fill("123456");
      await popup.getByRole("button", { name: "Continue" }).click();
      await expect(popup.getByRole("heading")).toHaveText("Signed in");
      await a.reload();
      await expect(a.getByRole("heading")).toHaveText("Signed in");
      await b.reload();
      await expect(b.getByRole("heading")).toHaveText("Signed out");
      const cookies = await alice.context.cookies("https://travel.example/");
      expect(cookies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "session",
            httpOnly: true,
            secure: true,
          }),
          expect.objectContaining({ name: "currency", value: "USD" }),
        ]),
      );
      const accountReady = a.waitForEvent("popup");
      await a.getByRole("link", { name: "Account", exact: true }).click();
      const account = await accountReady;
      await expect(account.getByRole("heading")).toHaveText("Your account");
      await first.assertHealthy();
      const { traces } = await first.inspect();
      expect(
        traces
          .filter(
            (trace) => new URL(trace.url).origin === "https://identity.example",
          )
          .map((trace) => [
            trace.method,
            new URL(trace.url).pathname,
            trace.status,
          ]),
      ).toEqual([
        ["GET", "/authorize", 200],
        ["POST", "/verify", 307],
        ["POST", "/exchange", 401],
        ["GET", "/authorize", 200],
        ["POST", "/verify", 307],
        ["POST", "/exchange", 303],
      ]);
      await a.goto("https://travel.example/worker-account");
      await expect(a.getByRole("heading")).toHaveText("Your account");
      await first.reset();
      await a.reload();
      await expect(a.getByRole("heading")).toHaveText("Signed out");
      await account.reload();
      await expect(account.getByRole("heading")).toHaveText("Signed out");
      await alice.close();
      await bob.close();
    } finally {
      await browser.close();
    }
  } finally {
    await sandbox.close();
  }
});

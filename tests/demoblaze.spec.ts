import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  startSandbox,
  WebsimClient,
  createBrowserSession,
} from "../src/index.js";

test("real captured storefront: browse, reject a bad password, log in, mutate a cart and check out locally", async () => {
  test.skip(
    !existsSync("examples/demoblaze/captures/store/manifest.json"),
    "Run npm run capture:demo to obtain the third-party frontend.",
  );
  const { default: definition } =
    await import("../examples/demoblaze/websim.config.js");
  const server = await startSandbox({
    config: "examples/demoblaze/websim.config.ts",
  });
  const browser = await server.connectBrowser();
  const client = new WebsimClient(server);
  const instance = await client.createInstance();
  const other = await client.createInstance({ scenario: "saved-cart" });
  const session = await createBrowserSession(browser, instance);
  try {
    const page = await session.context.newPage();
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await page.goto(definition.entrypoint);
    await expect(
      page.getByRole("link", { name: "Samsung galaxy s6", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Laptops", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "MacBook air", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Log in", exact: true }).click();
    await page.locator("#loginusername").fill("demo");
    await page.locator("#loginpassword").fill("wrong");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect.poll(() => dialogs).toContain("Wrong password.");
    await instance.assertHealthy();
    await page.locator("#loginpassword").fill("websim");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByText("Welcome demo", { exact: true })).toBeVisible();
    await page
      .getByRole("link", { name: "Samsung galaxy s6", exact: true })
      .click();
    await page.getByRole("link", { name: "Add to cart" }).click();
    await expect.poll(() => dialogs).toContain("Product added.");
    await page.getByRole("link", { name: "Cart", exact: true }).click();
    await expect(page.locator("#tbodyid")).toContainText("Samsung galaxy s6");
    await expect(page.locator("#totalp")).toHaveText("360");
    await page.screenshot({
      path: test.info().outputPath("storefront.png"),
      fullPage: true,
    });
    expect(
      Object.keys((await instance.inspect()).state.cart ?? {}),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "Place Order" }).click();
    await page.locator("#name").fill("Local Test");
    await page.locator("#card").fill("0000000000000000");
    await page.getByRole("button", { name: "Purchase", exact: true }).click();
    await expect(
      page.getByText("Thank you for your purchase!", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          Object.keys((await instance.inspect()).state.orders ?? {}).length,
      )
      .toBe(1);
    expect(
      Object.keys((await instance.inspect()).state.cart ?? {}),
    ).toHaveLength(0);
    expect(Object.keys((await other.inspect()).state.cart ?? {})).toHaveLength(
      1,
    );
    await instance.assertHealthy();
    await session.close();
  } finally {
    await browser.close();
    await server.close();
  }
});

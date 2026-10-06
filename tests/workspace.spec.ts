import { startWorkspace } from "../src/workspace/server.js";
import { test, expect } from "@playwright/test";
import { WebsimClient } from "../src/index.js";

test("workspace switches between isolated simulations, inspects state, and controls their browsers", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workspace = await startWorkspace({
    directory: "tests/fixtures/workspace",
  });
  try {
    expect((await fetch(`${workspace.url}/api/workspace`)).status).toBe(200);
    await page.goto(`${workspace.url}/ui/`);
    await expect(
      page.getByText("Select a simulation", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Simulations" }).getByRole("button"),
    ).toHaveCount(2);
    await page.getByRole("button", { name: "bank-a", exact: true }).click();
    await page.getByRole("button", { name: "Start instance" }).click();
    await page.getByRole("tab", { name: "State", exact: true }).click();
    await expect(page.locator("pre")).toContainText("10000");
    await page.getByRole("button", { name: "Open browser" }).click();
    const screen = page.getByRole("img", {
      name: "Interactive simulation browser",
    });
    await expect(screen).toBeVisible();
    await screen.focus();
    await screen.press("Tab");
    await screen.press("5");
    await screen.press("0");
    await screen.press("Enter");
    await page.getByRole("tab", { name: "State", exact: true }).click();
    await expect(page.locator("pre")).toContainText("15000");
    const firstId = await page
      .getByLabel("Instance", { exact: true })
      .inputValue();
    await expect(
      page.getByRole("button", { name: "Start instance", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "New instance", exact: true })
      .click();
    await page.getByLabel("Scenario", { exact: true }).selectOption("empty");
    await page
      .getByRole("button", { name: "Create instance", exact: true })
      .click();
    await expect(
      page.getByText("Running instances (2)", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("pre")).toContainText('"balance": 0');
    // Manual sessions share Chromium, but stopping one must leave the other usable.
    await page.getByRole("button", { name: "Open browser" }).click();
    await expect(screen).toBeVisible();
    await page.getByRole("tab", { name: "State", exact: true }).click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator("pre")).toContainText("15000");
    await page.getByRole("button", { name: "Open browser" }).click();
    const catalogForScroll = await (
      await fetch(`${workspace.url}/api/workspace`)
    ).json();
    const connectionForScroll = await (
      await fetch(
        `${workspace.url}/api/simulations/${catalogForScroll.simulations[0].id}/connection`,
      )
    ).json();
    const instanceForScroll = new WebsimClient(connectionForScroll).instance(
      firstId,
    );
    const previousFrame = await screen.getAttribute("src");
    await page.getByLabel("Browser address").fill("https://scroll.example/");
    await page.getByLabel("Browser address").press("Enter");
    await expect.poll(() => screen.getAttribute("src")).not.toBe(previousFrame);
    const bounds = await screen.boundingBox();
    expect(bounds).not.toBeNull();
    const scale = bounds!.width / 1280;
    await page.mouse.move(bounds!.x + 100 * scale, bounds!.y + 100 * scale);
    await page.mouse.wheel(80, 200);
    await expect
      .poll(() =>
        instanceForScroll.readState<{ x: number; y: number }>("scroll", "left"),
      )
      .toEqual({ x: expect.any(Number), y: expect.any(Number) });
    const left = await instanceForScroll.readState<{ x: number; y: number }>(
      "scroll",
      "left",
    );
    expect(left!.x).toBeGreaterThan(0);
    expect(left!.y).toBeGreaterThan(0);
    expect(
      await instanceForScroll.readState("scroll", "right"),
    ).toBeUndefined();
    await page.mouse.move(bounds!.x + 750 * scale, bounds!.y + 100 * scale);
    await page.mouse.wheel(0, 200);
    await expect
      .poll(
        async () =>
          (await instanceForScroll.readState<{ y: number }>("scroll", "right"))
            ?.y ?? 0,
      )
      .toBeGreaterThan(0);
    expect(await instanceForScroll.readState("scroll", "left")).toEqual(left);
    expect(
      await page.evaluate(() => ({
        window: window.scrollY,
        panel: document.querySelector('[role="tabpanel"][data-state="active"]')
          ?.scrollTop,
      })),
    ).toEqual({ window: 0, panel: 0 });
    await page.getByRole("tab", { name: "Requests", exact: true }).click();
    await page.getByLabel("Filter requests").fill("/api/deposits");
    await page
      .getByRole("button", {
        name: "https://north.example/api/deposits",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Request detail" }),
    ).toContainText("15000");
    await page
      .getByRole("dialog", { name: "Request detail" })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByRole("button", { name: "bank-b", exact: true }).click();
    await page.getByLabel("Scenario", { exact: true }).selectOption("empty");
    await page.getByRole("button", { name: "Start instance" }).click();
    await page.getByRole("tab", { name: "State", exact: true }).click();
    await expect(page.locator("pre")).toContainText('"balance": 0');
    await page.getByRole("button", { name: "bank-a", exact: true }).click();
    await page.getByLabel("Instance", { exact: true }).selectOption(firstId);
    await page.getByRole("tab", { name: "State", exact: true }).click();
    await expect(page.locator("pre")).toContainText("15000");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText(/WEBSIM_BROWSER_ENDPOINT=/)).toBeVisible();
    await page
      .getByRole("button", { name: "Close connection details" })
      .click();
    const catalog = await (
      await fetch(`${workspace.url}/api/workspace`)
    ).json();
    expect(
      catalog.simulations.every((entry: { running: boolean }) => entry.running),
    ).toBe(true);
    const connection = await (
      await fetch(
        `${workspace.url}/api/simulations/${catalog.simulations[0].id}/connection`,
      )
    ).json();
    expect(
      await new WebsimClient(connection)
        .instance(firstId)
        .readState("accounts", "main"),
    ).toEqual({ balance: 15000 });
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.locator("pre")).toContainText("10000");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(
      page.getByText("No instance selected", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "accounts", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("workspace.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "bank-b", exact: true }).click();
    await expect(
      page.getByLabel("Instance", { exact: true }).locator("option"),
    ).toHaveCount(1);
  } finally {
    await workspace.close();
  }
});

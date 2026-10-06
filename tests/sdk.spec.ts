import { test as websimTest, expect } from "../src/playwright.js";
import { startSandbox } from "../src/index.js";

const test = websimTest.extend<
  {},
  { sandbox: Awaited<ReturnType<typeof startSandbox>> }
>({
  sandbox: [
    async ({}, use) => {
      const sandbox = await startSandbox({
        config: "tests/fixtures/account/websim.config.ts",
      });
      try {
        await use(sandbox);
      } finally {
        await sandbox.close();
      }
    },
    { scope: "worker" },
  ],
  websimServer: async ({ sandbox }, use) => {
    await use(sandbox);
  },
  connectOptions: [
    async ({ sandbox }, use) => {
      await use({ wsEndpoint: sandbox.browserEndpoint });
    },
    { scope: "worker" },
  ],
});
test.use({
  websimOptions: {
    scenario: "deposit-retry",
  },
});
test("a scenario drives browser failure, recovery and reset through domain handlers", async ({
  page,
  websim,
}) => {
  await page.goto("https://north.example/");
  await expect(page.getByLabel("Balance")).toHaveText("£25.00");
  await page.getByLabel("Amount in GBP").fill("50");
  await page.getByRole("button", { name: "Add money" }).click();
  await expect(page.getByRole("status", { name: "Deposit result" })).toHaveText(
    "Deposits unavailable. Try again.",
  );
  await expect(page.getByLabel("Balance")).toHaveText("£25.00");
  await websim.assertHealthy();
  await page.getByRole("button", { name: "Add money" }).click();
  await expect(page.getByLabel("Balance")).toHaveText("£75.00");
  expect(
    await websim.readState<{ balance: number }>("accounts", "main"),
  ).toEqual({ balance: 7500 });
  const { traces } = await websim.inspect();
  expect(
    traces.find(
      (trace) => trace.url.endsWith("/api/deposits") && trace.status === 200,
    )?.stateChanges,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        collection: "accounts",
        before: { balance: 2500 },
        after: { balance: 7500 },
      }),
    ]),
  );
  await websim.reset();
  await page.reload();
  await expect(page.getByLabel("Balance")).toHaveText("£25.00");
  await page.getByLabel("Amount in GBP").fill("50");
  await page.getByRole("button", { name: "Add money" }).click();
  await expect(page.getByRole("status", { name: "Deposit result" })).toHaveText(
    "Deposits unavailable. Try again.",
  );
  await expect(page.getByLabel("Balance")).toHaveText("£25.00");
});

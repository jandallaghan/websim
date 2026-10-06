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
    seed: "empty",
    state: { accounts: { main: { balance: 2500 } } },
  },
});
test("the public fixture owns isolation, typed state inspection and automatic healthy teardown", async ({
  page,
  websim,
}) => {
  await page.goto("https://north.example/");
  await expect(page.getByLabel("Balance")).toHaveText("£25.00");
  await page.getByLabel("Amount in GBP").fill("50");
  await page.getByRole("button", { name: "Add money" }).click();
  await expect(page.getByLabel("Balance")).toHaveText("£75.00");
  expect(
    await websim.readState<{ balance: number }>("accounts", "main"),
  ).toEqual({ balance: 7500 });
  const { traces } = await websim.inspect();
  expect(
    traces.find((trace) => trace.url.endsWith("/api/deposits"))?.stateChanges,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        collection: "accounts",
        before: { balance: 2500 },
        after: { balance: 7500 },
      }),
    ]),
  );
});

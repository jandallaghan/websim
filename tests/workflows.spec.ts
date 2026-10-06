import { startServer } from "../src/server/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { startCapture } from "../src/capture/index.js";
import {
  WebsimClient,
  createBrowserSession,
  SimulationRunError,
} from "../src/index.js";
import { startBank, banking } from "./fixture-site.js";

test("capture a website, turn off the origin, and run independent stateful browser workflows", async ({
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "websim-e2e-"));
  const origin = await startBank();
  const recorder = await startCapture({
    url: origin.url,
    directory: join(directory, "capture"),
    name: "bank",
    interfaces: [process.platform === "darwin" ? "lo0" : "lo"],
    filter: `tcp port ${new URL(origin.url).port}`,
    chromePath: process.env.WEBSIM_TEST_CHROME,
    chromeArgs: ["--headless=new", "--no-sandbox"],
  });
  await origin.visited;
  const archive = await recorder.stop();
  await origin.close(); // Replay cannot succeed by accidentally falling back to the origin.
  const server = await startServer(banking(origin.url, archive));
  const client = new WebsimClient(server);
  const first = await client.createInstance({
    scenario: "funded",
    time: "2026-10-06T12:00:00.000Z",
  });
  const second = await client.createInstance({ scenario: "empty" });
  const alice = await createBrowserSession(browser, first);
  const bob = await createBrowserSession(browser, second);
  try {
    const a = await alice.context.newPage();
    const b = await bob.context.newPage();
    await Promise.all([a.goto(origin.url), b.goto(origin.url)]);
    const browserTime = await a.evaluate(() => Date.now());
    expect(browserTime).toBeGreaterThanOrEqual(
      Date.parse("2026-10-06T12:00:00.000Z"),
    );
    expect(browserTime).toBeLessThan(Date.parse("2026-10-06T12:01:00.000Z"));
    await expect
      .poll(() => a.evaluate(() => Date.now()))
      .toBeGreaterThan(browserTime);
    await expect(a.getByLabel("Balance")).toHaveText("10000");
    await expect(b.getByLabel("Balance")).toHaveText("0");
    await a.getByLabel("Deposit in cents").fill("5000");
    await a.getByRole("button", { name: "Deposit" }).click();
    await expect(a.getByLabel("Balance")).toHaveText("15000");
    await b.reload();
    await expect(b.getByLabel("Balance")).toHaveText("0");
    await a.getByLabel("Deposit in cents").fill("-10");
    await a.getByRole("button", { name: "Deposit" }).click();
    await expect(a.getByRole("status", { name: "Deposit result" })).toHaveText(
      "Enter a positive amount",
    );
    await first.assertHealthy();
    expect((await first.inspect()).state.accounts?.main).toEqual({
      balance: 15000,
    });
    await first.reset();
    await a.reload();
    await expect(a.getByLabel("Balance")).toHaveText("10000");
    await alice.close();
    await bob.close();
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("scenario failures recover and reset independently of simulation diagnostics", async () => {
  const server = await startServer(banking("https://bank.example"));
  const client = new WebsimClient(server);
  const instance = await client.createInstance({ scenario: "maintenance" });
  const other = await client.createInstance();
  const request = {
    url: "https://bank.example/account",
    method: "GET",
    headers: {},
    body: null,
  };
  try {
    expect((await fetch(`${server.url}/api/instances`)).status).toBe(401);
    expect(
      (
        await fetch(`${server.url}/api/instances`, {
          headers: {
            authorization: `Bearer ${server.token}`,
            origin: "https://foreign.example",
          },
        })
      ).status,
    ).toBe(403);
    expect((await instance.dispatch(request)).status).toBe(503);
    await instance.assertHealthy();
    expect((await other.dispatch(request)).status).toBe(200);
    expect((await instance.dispatch(request)).status).toBe(200);
    await instance.reset();
    expect((await instance.dispatch(request)).status).toBe(503);
    expect((await other.dispatch(request)).status).toBe(200);
    expect((await instance.inspect()).traces[0]?.source).toBe(
      "module:accounts",
    );
    const missing = await instance.dispatch({
      ...request,
      url: "https://bank.example/unknown",
    });
    expect(missing.status).toBe(502);
    await expect(instance.assertHealthy()).rejects.toBeInstanceOf(
      SimulationRunError,
    );
    expect((await instance.inspect()).diagnostics[0]?.code).toBe(
      "UNMATCHED_REQUEST",
    );
    await instance.reset();
    await instance.assertHealthy();
    // Parallel deposits must not overwrite one another.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        instance.dispatch({
          url: "https://bank.example/deposit",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: Buffer.from('{"amount":100}').toString("base64"),
        }),
      ),
    );
    expect((await instance.inspect()).state.accounts?.main).toEqual({
      balance: 12000,
    });
  } finally {
    await server.close();
  }
});

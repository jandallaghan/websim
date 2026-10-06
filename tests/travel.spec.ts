import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  startSandbox,
  WebsimClient,
  createBrowserSession,
  type InstanceHandle,
} from "../src/index.js";

// These recordings contain private account evidence and are deliberately not distributed.
// The tests verify business flows; the attached reports retain every ancillary capture gap.
async function travel(
  site: string,
  run: (
    page: Page,
    instance: InstanceHandle,
    client: WebsimClient,
  ) => Promise<void>,
) {
  test.skip(
    !existsSync(`examples/${site}/captures/session/manifest.json`),
    `Requires the private ${site} recording.`,
  );
  test.setTimeout(120_000);
  const sandbox = await startSandbox({
    config: `examples/${site}/websim.config.ts`,
  });
  const browser = await sandbox.connectBrowser();
  const client = new WebsimClient(sandbox);
  const instance = await client.createInstance();
  const session = await createBrowserSession(browser, instance);
  const page = await session.context.newPage();
  try {
    await run(page, instance, client);
  } finally {
    await test.info().attach("simulation-report", {
      body: JSON.stringify(await instance.inspect(), null, 2),
      contentType: "application/json",
    });
    await browser.close();
    await sandbox.close();
  }
}

async function ready(page: Page) {
  // Analytics can keep real frontends busy after their interactive content has loaded.
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

function expectCovered(
  report: Awaited<ReturnType<InstanceHandle["inspect"]>>,
  paths: RegExp,
) {
  expect(
    report.traces.filter(
      (trace) => trace.diagnostic && paths.test(new URL(trace.url).pathname),
    ),
  ).toEqual([]);
}

test("Airbnb: partial destination search, local email sign-in, booking review and isolated reset", async () => {
  await travel("airbnb", async (page, instance, client) => {
    const other = await client.createInstance({ scenario: "sold-out" });
    await page.goto("https://www.airbnb.ie/?locale=en");
    await ready(page);
    await page
      .getByRole("searchbox", { name: "Where", exact: true })
      .fill("pari");
    await page
      .getByRole("option", { name: "Paris, France", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Only necessary", exact: true })
      .click();
    await page.getByRole("button", { name: "When Add dates" }).click();
    await page
      .getByRole("button", { name: /^10, Tuesday, November 2026/ })
      .click();
    await page
      .getByRole("button", { name: /^13, Friday, November 2026/ })
      .click();
    await page.getByRole("button", { name: "Who Add guests" }).click();
    await page
      .getByRole("button", { name: "Increase Adults", exact: true })
      .click({ clickCount: 2 });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("link", { name: "Flat in Paris", exact: true })
      .press("Enter");
    const detail = await popup;
    await detail
      .getByRole("dialog", { name: "Translation on" })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await detail
      .getByRole("button", { name: "Log in or sign up", exact: true })
      .click();
    await detail
      .getByRole("textbox", { name: "Phone number or email" })
      .fill("traveler@example.test");
    await detail.getByRole("button", { name: "Continue", exact: true }).click();
    await detail
      .getByRole("textbox", { name: "One Time Code Input" })
      .fill("123456");
    await expect(
      detail.getByRole("link", { name: "Profile", exact: true }),
    ).toBeVisible();
    await detail.getByRole("button", { name: "Reserve", exact: true }).click();
    await expect(
      detail.getByRole("heading", { name: "Request to book", exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByRole("radio", { name: "Pay €404.60 now", exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByRole("radio", { name: "Pay €0 now", exact: true }),
    ).toBeVisible();
    const report = await instance.inspect();
    expectCovered(report, /^\/api\//);
    expect(report.state.checkout?.current).toMatchObject({ stage: "review" });
    const search = report.traces.find(
      (trace) =>
        trace.source === "module:search" && trace.url.includes("/StaysSearch/"),
    )!;
    const unavailable = await other.dispatch({
      url: search.url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from(search.requestBody!).toString("base64"),
    });
    expect(unavailable.status).toBe(200);
    const results = JSON.parse(
      Buffer.from(unavailable.body, "base64").toString(),
    ).data.presentation.staysSearch.results;
    expect(results.searchResults).toEqual([]);
    expect(results.filters.filterPanel.resultCount).toBe(0);
    await other.assertHealthy();
    expect((await other.inspect()).state.sessions).toBeUndefined();
    await detail.screenshot({
      path: test.info().outputPath("booking-review.png"),
    });
    await instance.reset();
    await detail.goto(
      "https://www.airbnb.ie/rooms/1172994310245519962?adults=2&check_in=2026-11-10&check_out=2026-11-13",
    );
    await expect(
      detail.getByRole("button", { name: "Log in or sign up", exact: true }),
    ).toBeVisible();
    expect((await instance.inspect()).state.sessions).toBeUndefined();
    expect((await other.inspect()).scenario).toBe("sold-out");
  });
});

test("Booking.com: destination, dates, cancellation filter, room selection and guest details", async () => {
  await travel("booking", async (page, instance, client) => {
    const other = await client.createInstance();
    await page.goto("https://www.booking.com/");
    await ready(page);
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await page
      .getByRole("button", { name: "Dismiss sign-in info.", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Enter destination" }).fill("Par");
    await page
      .getByRole("option", { name: "Paris Ile de France, France", exact: true })
      .first()
      .click();
    await page
      .getByRole("checkbox", {
        name: "Tuesday, November 10, 2026",
        exact: true,
      })
      .click();
    await page
      .getByRole("checkbox", { name: "Friday, November 13, 2026", exact: true })
      .click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("checkbox", { name: /^Free cancellation:/ })
      .first()
      .check();
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("link", { name: "Est Hotel Opens in new window", exact: true })
      .click();
    const property = await popup;
    await ready(property);
    await property
      .getByRole("combobox", { name: "Select Rooms", exact: true })
      .first()
      .selectOption("1");
    await property
      .getByRole("button", { name: "I'll reserve", exact: true })
      .click();
    await expect(
      property.getByRole("heading", {
        name: "Enter your details",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      property.getByRole("textbox", { name: "First name *", exact: true }),
    ).toBeEmpty();
    await expect(property.locator("body")).toContainText("1 x Twin Room");
    const report = await instance.inspect();
    expectCovered(
      report,
      /^\/(dml\/graphql|book\.html|searchresults\.html|hotel\/)/,
    );
    expect(Object.values(report.state.baskets ?? {})).toEqual([
      expect.objectContaining({ stage: "guest-details", hotelId: 51451 }),
    ]);
    expect((await other.inspect()).state.baskets).toBeUndefined();
    await property.screenshot({
      path: test.info().outputPath("guest-details.png"),
    });
    await instance.reset();
    expect((await instance.inspect()).state.baskets).toBeUndefined();
  });
});

test("Delta: airport search, fare comparison, two flight selections and pre-payment review", async () => {
  await travel("delta", async (page, instance, client) => {
    const other = await client.createInstance();
    await page.goto("https://www.delta.com/eu/en");
    await page
      .getByRole("button", { name: "Necessary Only", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Origin, DUB, Dublin, Ireland" })
      .click();
    await page
      .getByRole("textbox", { name: "Origin", exact: true })
      .fill("Kennedy");
    await page.getByRole("option", { name: /^JFK / }).click();
    await page
      .getByRole("button", {
        name: "One Way Route Picker Home Desktop Ow Destination",
      })
      .click();
    await page
      .getByRole("textbox", { name: "Destination", exact: true })
      .fill("Los Angeles");
    await page.getByRole("option", { name: /^LAX / }).click();
    await page
      .getByRole("button", {
        name: "Flight Date Field, DepartDate - ReturnDate",
      })
      .click();
    await page
      .getByRole("gridcell", { name: "November 10, 2026", exact: true })
      .last()
      .click();
    await page
      .getByRole("gridcell", { name: "November 13, 2026", exact: true })
      .last()
      .click();
    await page
      .getByRole("button", { name: /^Date Picker .* Done Button$/ })
      .click();
    await page
      .getByRole("button", { name: "Find Flights", exact: true })
      .click();
    await page
      .locator(".rounded-amount:visible")
      .filter({ hasText: /^407$/ })
      .first()
      .click();
    await page.getByRole("button", { name: /^Select Main.*Classic/ }).click();
    await page
      .locator(".rounded-amount:visible")
      .filter({ hasText: /^517$/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Trip Summary", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Continue to Review & Pay", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review and Pay", exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText("516.81");
    const report = await instance.inspect();
    expectCovered(
      report,
      /^\/(checkout\/|shop\/|prd\/rm-offer|baggage\/|merchandize\/)/,
    );
    expect(Object.values(report.state.carts ?? {})).toEqual([
      expect.objectContaining({ stage: "review" }),
    ]);
    expect((await other.inspect()).state.carts).toBeUndefined();
    await page.screenshot({
      path: test.info().outputPath("review-and-pay.png"),
    });
    await instance.reset();
    await page.reload();
    await expect(page.locator("body")).toContainText("websim");
    expect((await instance.inspect()).state.carts).toBeUndefined();
  });
});

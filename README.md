# Websim

Stateful website simulations for testing browser agents and integrations.

Testing against a real website is hard to repeat. Data changes, services fail, and reproducing a specific condition—an empty account, a saved cart, a rejected payment—can be difficult or impossible.

Websim lets you capture a website and use a coding agent to build a high-fidelity simulation of the workflows you need. Run its real frontend against local TypeScript handlers, set up specific scenarios, and point your agent or integration at an isolated browser. During simulation, the browser has no outbound network access to the real website or any other service.

## How it works

1. **Capture.** Browse the real website in ordinary Chrome. Websim records packets and TLS keys, then extracts frontend assets and HTTP requests and responses.
2. **Build.** Give the capture and your desired workflows to your coding agent. It uses the captured responses and JavaScript to write modular handlers for stateful behavior and paths you did not capture.
3. **Run.** Start instances from different initial states. Walk through them in the local UI, or connect your test or agent to the isolated browser.

Captured responses handle static assets and matching requests. TypeScript handlers handle behavior such as logging in, changing a cart, or placing an order. A capture is evidence for building a simulation; it does not automatically model every workflow.

## Get started

Requires Node.js 22.15+, Docker, Google Chrome, and Wireshark 4.x (`dumpcap` and `tshark`). Live capture supports macOS and Linux; configure Wireshark’s packet-capture permissions for your user first.

From a clone of this repository:

```sh
npm ci
npx playwright install chromium
npm run build

node dist/cli.js init simulations/my-site https://example.com
node dist/cli.js capture https://example.com --output simulations/my-site/captures/session
```

Browse the workflows you want to capture, then press Enter in the terminal to save. Each capture needs a new output directory. Use your coding agent to implement and verify the simulation, then open the workspace:

```sh
npm run dev -- simulations
```

Visit [localhost:4100/ui](http://127.0.0.1:4100/ui/). The UI lists your simulations and lets you start, reset, and stop instances, use their browsers, and inspect requests and state. Keep each website in its own directory with a `websim.config.ts`, modules, and captures. Restart the workspace after changing code or captures.

For an existing simulation to try, see the [Demoblaze storefront example](examples/demoblaze/README.md).

## Scenarios and state

Scenarios define starting state and behavior: an empty cart, an existing customer, or an unavailable checkout. Handlers read behavior settings and update state as the browser interacts with the site.

```ts
scenarios: {
  "checkout-unavailable": {
    description: "An existing customer whose checkout service is unavailable.",
    behavior: { checkout: "unavailable" },
    initialize({ state }) {
      state.set("users", "demo", { name: "Demo customer" });
    },
  },
},
defaultScenario: "checkout-unavailable",
```

In a Hono handler:

```ts
const { behavior, state } = c.get("simulation");
if (behavior.checkout === "unavailable") {
  return c.json({ error: "Checkout is temporarily unavailable" }, 503);
}
// Continue the normal checkout using instance state.
```

Behavior settings are immutable strings, numbers, booleans, or null. Track changing conditions, such as retry attempts, in state. Resetting an instance reruns its scenario initializer and clears its request history.

Each instance has separate state, browser contexts, and request history, so tests can run different scenarios against the same simulation without interfering with each other.

```ts
import { startSandbox, WebsimClient, createBrowserSession } from "@websim/core";

const sandbox = await startSandbox({
  config: "examples/demoblaze/websim.config.ts",
});

try {
  const client = new WebsimClient(sandbox);
  const instance = await client.createInstance({ scenario: "saved-cart" });
  const browser = await sandbox.connectBrowser();
  const session = await createBrowserSession(browser, instance);
  const page = await session.context.newPage();

  await page.goto("https://www.demoblaze.com/");
  // Run your browser integration or agent using this session.

  await instance.assertHealthy();
  await instance.reset();
} finally {
  await sandbox.close();
}
```

Browser time starts at the first capture’s timestamp and advances normally; handler time stays fixed for deterministic state changes. Set `createInstance({ time: "2026-11-10T12:00:00Z" })` to choose another time.

A response such as “invalid password” is normal application behavior. A missing capture match or a broken handler is a simulation error, recorded separately and surfaced by `assertHealthy()`.

The browser runs inside Docker with outbound networking disabled and keeps the website’s original URLs. Your code controls it through a remote Playwright connection. An instance-specific HTTP/HTTPS proxy inside the sandbox supplies captured responses and runs handlers, including for redirects, popups, and service workers. The sandbox browser trusts only the runner’s ephemeral proxy certificate; the host trust store is unchanged. The proxy never connects to the real site. Capture uses ordinary Chrome without Playwright or a debugging connection.

See the [storefront test](tests/demoblaze.spec.ts) and [travel simulations](examples/README.md) for workflows and their coverage. The package is not published to npm yet; use `npm pack` to install it in another project.

## Capture details and limits

Inspect a capture before writing handlers. These commands return JSON for you or your coding agent:

```sh
node dist/cli.js inspect captures/session                     # Origins and exchange counts
node dist/cli.js inspect captures/session --url /api/search   # Matching requests and entry IDs
node dist/cli.js inspect captures/session --entry <id>        # Request and response evidence
node dist/cli.js inspect captures/session --warnings          # Missing or unsupported traffic
```

- HTTP/1.1 and HTTP/2 are supported. QUIC is disabled during capture.
- WebSocket frames are recorded as evidence; WebSocket simulation and streaming are not supported.
- The capture SDK exports `startCapture()` and `importCapture()` from `@websim/core/capture`. The CLI can also import an existing PCAP and TLS key file:

  ```sh
  node dist/cli.js import --pcap traffic.pcapng --keys tls.keys --output captures/imported
  ```

- Raw recordings stay in `raw/` and may contain secrets and other applications’ traffic. They are excluded from Git and Docker images. Decoded archives strip authorization and cookie headers, but bodies may still contain secrets; review before sharing. Import warnings identify incomplete or unsupported traffic.
- Instances live in memory and disappear when the runner stops. Docker isolation is intended for local development, not hostile multi-tenant hosting.

See [contributing](CONTRIBUTING.md) for development instructions.

## License

Websim is source-available under the [Elastic License 2.0](LICENSE). You can use, modify, and redistribute it under those terms, including for internal commercial work. Offering a hosted or managed service that exposes a substantial set of Websim’s features or functionality to third parties requires a separate license from the copyright holders.

Third-party components retain their own licenses; see [LICENSES](LICENSES). Captured third-party resources retain their original ownership and terms.

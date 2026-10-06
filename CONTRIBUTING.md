# Contributing

Use Node.js 22.15 or newer and a running Docker Engine or Docker Desktop. Install dependencies with `npm ci`, install Chromium with `npx playwright install chromium`, and build with `npm run build`.

Capture tests also require Google Chrome, OpenSSL, and Wireshark 4.x with `dumpcap` capture permissions. On macOS install Wireshark’s ChmodBPF package. On Linux grant capture access to `dumpcap` through your distribution’s Wireshark setup. Tests capture only owned loopback servers; Playwright controls the offline replay browser, never the capture browser.

Before proposing a change, run:

```sh
npm run format
npm run check
npm run build
docker build -f docker/Dockerfile -t websim-sandbox:local .
npm test
```

Keep public interfaces small and documented. Runtime modules must not depend on the UI or browser launch code. Simulation behavior belongs in domain modules, not the request dispatcher. Keep mutable state in the instance context.

Prefer a few end-to-end tests that prove user workflows. A regression test should demonstrate a failure someone could encounter while capturing, authoring, running, or inspecting a simulation. Avoid tests that merely duplicate implementation details.

The default test suite uses an owned website. Image construction needs network access for dependencies; simulation execution and test receivers are local. `npm run capture:demo` enables the additional real-storefront integration test; do not make public-site availability a prerequisite for CI.

Never commit private captures, authentication state, access tokens, or generated build output. Captured third-party assets retain their own rights.

If a public API or capture schema changes, describe migration and compatibility implications. New transport features must preserve instance isolation and the distinction between application responses and simulation failures.

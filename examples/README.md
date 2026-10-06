# Simulations

These examples run the captured websites’ frontends inside Websim’s network sandbox. Handlers model the covered requests and maintain instance state. Unmodeled requests produce simulation diagnostics; they never reach the live site.

| Simulation  | Verified flow                                                                                        | Dataset                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Airbnb      | Destination autocomplete → dated search → listing → local email-code login → Request to book         | Paris, 10–13 November 2026, two adults; London search/detail, 1–6 November, one adult |
| Booking.com | Paris autocomplete → dated search → free cancellation → Est Hotel twin room → guest details          | 10–13 November 2026, two adults, one room                                             |
| Delta       | Airport autocomplete → outbound fares → Main Classic → return flight → Trip Summary → Review and Pay | JFK–LAX, 10–13 November 2026, one adult; DL742 outbound, DL979 return                 |

Search text can vary within this inventory. Dates, occupancy, and fares outside the captured quotes are rejected explicitly. Airbnb also supports price filtering and a `sold-out` scenario. Every instance has its own login, selection, and cart state.

Airbnb’s local email code is `123456`; use a synthetic address such as `traveler@example.test`. Booking.com and Delta currently cover guest checkout. Delta’s sign-in initiation is modeled, but credential and CAPTCHA outcomes are not. Social login, submitting bookings, and payment are not implemented.

## Run locally

Private decoded archives must be present under each example’s `captures/` directory:

- Airbnb: `session`, `auth`, `search`
- Booking.com and Delta: `session`

```sh
npm run build
docker build -t websim-sandbox:local -f docker/Dockerfile .
node dist/cli.js dev examples
npx playwright test tests/travel.spec.ts
```

Open the URL printed by the dev command, choose a simulation, and start an instance.

The archives are intentionally excluded from Git. They include third-party assets and private authentication evidence. A fresh recording will need its own evidence review; these handlers are not universal adapters for future versions of the sites.

The travel tests assert the business flows, state isolation, and reset. Their attached reports retain all diagnostics. Some maps, advertising, telemetry, and optional resources remain outside coverage; a passing business-flow test does not mean the entire page passes `assertHealthy()`. The core tests separately exercise strict health checks, redirects, service workers, cookies, and network isolation using owned fixtures.

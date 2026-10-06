# Demoblaze simulation

This example captures [Demoblaze](https://www.demoblaze.com/), a public commerce test site, and reuses its frontend unchanged inside managed browser contexts.

## Run

From the repository root:

```sh
npm run capture:demo
npm run build
npm run demo:store
```

In the capture browser, visit the homepage, all three categories, the next product page, a product detail page, and the cart. Wait for images to load, then press Enter in the terminal. No automated browsing is used.

Start `empty` or `saved-cart` in the inspector, then open its managed browser. The local demo account is `demo` / `websim`. The browser address bar retains `www.demoblaze.com`; only this managed context routes it through the local simulator.

## Coverage and evidence

- Captured: homepage, product detail shell, cart shell, scripts, styles, fonts, product images, public catalog/category requests, and anonymous cart requests.
- Catalog module: derived from observed product data, with generalized filtering, pagination, and detail lookup.
- Authentication: inferred from the captured JavaScript's `/login`, `/check`, and `/signup` contracts. Credentials and sessions are local scenario state.
- Cart: inferred from `/addtocart`, `/viewcart`, `/deleteitem`, and `/deletecart` calls. State is per instance and cart ownership follows the site's anonymous-cookie or authenticated-user convention.
- Checkout: the original frontend generates its success dialog. We observe its delete-cart request and record a local order before clearing the cart. This is authored bookkeeping, not a claim that the real backend exposes an orders API.
- Background media: an explicitly authored finite empty HLS playlist. Video playback is outside this example's scope.

The `idp_` query key is ignored for captured product HTML because that shell is identical across products; the catalog module supplies the selected product through `/view`.

For this example, browse public pages only. There are no live account registrations, deposits, or purchases. The end-to-end test performs mutations through a managed local context.

## Updating evidence

Each recording uses a new directory. Move the previous `captures/store` aside before running `capture:demo` again, or capture to another directory and update `websim.config.ts`. Archives use format version 2; the old Playwright archive is not supported. Review import warnings and the decoded manifest before running the simulation.

Raw PCAPNG and TLS keys are retained under the capture’s `raw/` directory for re-import. They are not included in the simulation image.

Captures are ignored by Git. They include third-party code and media, whose rights are separate from Websim's MIT license. The repository ships the capture recipe and authored simulation code, not a license grant for downloaded material.

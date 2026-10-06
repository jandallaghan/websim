import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { chromium } from "playwright";
import { simulationCertificatePin } from "../server/certificate.js";
import { startServer } from "../server/server.js";
import { defineSimulation } from "../runtime/types.js";

const config = process.argv[2];
if (!config) throw new Error("A simulation configuration path is required");
const module = await tsImport(
  pathToFileURL(resolve(config)).href,
  import.meta.url,
);
const exported = module.default?.default ?? module.default;
const browser = await chromium.launchServer({
  headless: true,
  // Worker scripts need browser-level trust. Only this runner’s ephemeral key is accepted.
  args: [
    `--ignore-certificate-errors-spki-list=${await simulationCertificatePin()}`,
  ],
  port: 4101,
  host: "127.0.0.1",
});
const server = await startServer(
  defineSimulation(
    typeof exported === "function" ? await exported() : exported,
  ),
  {
    port: 4100,
    token: process.env.WEBSIM_TOKEN,
    browser: await chromium.connect(browser.wsEndpoint()),
    sandbox: { browserPath: new URL(browser.wsEndpoint()).pathname },
  },
);
const stop = async () => {
  await server.close();
  await browser.close();
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());

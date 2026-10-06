import { Hono } from "hono";
import type {
  CaptureArchive,
  CaptureEntry,
} from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  response,
  unsupported,
} from "../../shared/capture.js";

export function bootstrap(
  archive: CaptureArchive,
  authentication: CaptureArchive,
) {
  const routes = new Hono<SimulationEnv>();
  const fixed = new Set([
    "NaviServerAnnouncementsQuery",
    "PromotionsByPlacementsQuery",
    "Header",
    "GetConsentForUserQuery",
    "GetConsentFlagsQuery",
    "SearchInputQuery",
  ]);
  routes.all("/api/v3/:operation/:hash", async (c, next) => {
    if (!fixed.has(c.req.param("operation"))) return next();
    const entry = requireExchange(
      exchanges(archive, new URL(c.req.url).pathname).filter((entry) => {
        if (c.req.param("operation") !== "GetConsentForUserQuery") return true;
        const variables = JSON.parse(
          new URL(entry.url).searchParams.get("variables") ?? "{}",
        );
        return (
          Boolean(variables.consentId) ===
          Boolean(c.get("simulation").state.get("preferences", "consent"))
        );
      }),
      c.req.path,
    );
    return response(archive, entry);
  });
  for (const path of [
    "/api/v2/get-data-layer-variables",
    "/api/v2/client_configs",
  ]) {
    const entries = [
      ...exchanges(archive, path).map((entry) => ({ archive, entry })),
      ...exchanges(authentication, path)
        .filter((entry) =>
          JSON.parse(entry.requestBody ?? "{}").configs?.includes("airparam"),
        )
        .map((entry) => ({ archive: authentication, entry })),
    ];
    const key = (body: Record<string, unknown>) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(body)
            .filter(([name]) => name !== "bevId" && name !== "airParamsEtags")
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
    const variants = new Map<
      string,
      { archive: CaptureArchive; entry: CaptureEntry }
    >();
    for (const record of entries) {
      const signature = key(JSON.parse(record.entry.requestBody ?? "{}"));
      if (!variants.has(signature)) variants.set(signature, record);
    }
    routes.post(path, async (c) => {
      const entry = variants.get(key(await c.req.json()));
      if (!entry) unsupported(`Unobserved Airbnb bootstrap request: ${path}`);
      if (
        JSON.parse(entry.entry.requestBody ?? "{}").configs?.includes(
          "airparam",
        )
      ) {
        const payload = JSON.parse(
          (await entry.archive.body(entry.entry)).toString(),
          (key, value) => {
            if (
              ["user_id", "subject_id", "visitor_id", "misa_id"].includes(
                key,
              ) &&
              typeof value === "string"
            )
              return key === "user_id" ? "900000001" : "websim-identity";
            return value;
          },
        );
        return c.json(payload);
      }
      return response(entry.archive, entry.entry);
    });
  }
  routes.post("/api/v3/SubmitUserConsentMutation/:hash", async (c) => {
    const entry = requireExchange(
      exchanges(archive, c.req.path),
      "cookie consent",
    );
    c.get("simulation").state.set("preferences", "consent", await c.req.json());
    return response(archive, entry);
  });
  return routes;
}

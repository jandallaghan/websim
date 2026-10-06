import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import { requireExchange, unsupported } from "../../shared/capture.js";
import { demoUser } from "./authentication.js";

export async function profile(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  for (const operation of [
    "GetThumbnailPicQuery",
    "IsHostQuery",
    "WishlistIndexPageQuery",
    "get_travel_guides_by_user",
  ]) {
    const entry = requireExchange(
      archive.manifest.entries.filter((entry) =>
        new URL(entry.url).pathname.includes(`/${operation}`),
      ),
      operation,
    );
    const payload = JSON.parse((await archive.body(entry)).toString());
    delete payload.extensions;
    if (operation === "GetThumbnailPicQuery") {
      const image = payload.data.node.owner.userRepresentationUrl;
      image.thumbnailUrl = "";
      image.thumbnailUrlMedium = "";
    }
    if (operation === "IsHostQuery")
      payload.data.viewer.user.firstName = demoUser.first_name;
    routes.get(
      operation === "get_travel_guides_by_user"
        ? "/api/v2/get_travel_guides_by_user"
        : `/api/v3/${operation}/:hash`,
      (c) => {
        const session = getCookie(c, "websim_session");
        if (!session || !c.get("simulation").state.get("sessions", session))
          unsupported(
            "This profile request requires the local email sign-in flow.",
          );
        return c.json(payload);
      },
    );
  }
  return routes;
}

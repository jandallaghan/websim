import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";
import {
  exchanges,
  requireExchange,
  response,
  unsupported,
} from "../../shared/capture.js";

const steps = z.object({
  steps: z.array(
    z.object({
      identifyEmail: z.object({ email: z.email() }).optional(),
      emailOtpChallenge: z.object({ otp: z.string() }).optional(),
    }),
  ),
});
export const demoUser = {
  id: 900000001,
  id_str: "900000001",
  first_name: "Demo",
  last_name: "Traveler",
  smart_name: "Demo",
  profile_picture_u_r_l: "",
  native_currency: "EUR",
  preferred_locale: "en-IE",
  tos_confirmed: true,
  agreed_to_community_commitment: true,
};

export async function authentication(archive: CaptureArchive) {
  const routes = new Hono<SimulationEnv>();
  const options = requireExchange(
    exchanges(archive, "/api/v2/auth/options"),
    "email sign-in options",
  );
  const headers = await Promise.all(
    archive.manifest.entries
      .filter((entry) =>
        new URL(entry.url).pathname.startsWith("/api/v3/Header/"),
      )
      .map(async (entry) => JSON.parse((await archive.body(entry)).toString())),
  );
  const header = headers.find((payload) => payload.data.viewer?.user);
  if (!header) throw new Error("Missing captured authenticated header");
  const guestHeader = headers.find((payload) => !payload.data.viewer?.user);
  if (!guestHeader) throw new Error("Missing captured guest header");
  header.data.presentation.header.avatarImageUrl = null;
  routes.post("/api/v2/auth/options", () => response(archive, options));
  routes.post("/api/v2/auth/identify/email", async (c) => {
    const body = steps.parse(await c.req.json());
    const email = body.steps.find((step) => step.identifyEmail)?.identifyEmail
      ?.email;
    if (!email) unsupported("Email sign-in requires an email address.");
    const { state, id } = c.get("simulation");
    const challenge = id();
    state.set("challenges", challenge, { email });
    setCookie(c, "websim_challenge", challenge, {
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    const entry = requireExchange(
      exchanges(archive, "/api/v2/auth/identify/email").filter(
        (entry) => entry.status === 200,
      ),
      "email challenge",
    );
    const payload = JSON.parse((await archive.body(entry)).toString());
    payload.nextStepConfig.emailOtp.email = email;
    return c.json(payload);
  });
  routes.post("/api/v2/auth/authenticate/email_otp", async (c) => {
    const body = steps.parse(await c.req.json());
    const challenge = getCookie(c, "websim_challenge");
    const { state, id } = c.get("simulation");
    const pending =
      challenge && state.get<{ email: string }>("challenges", challenge);
    if (
      !pending ||
      !body.steps.some((step) => step.emailOtpChallenge?.otp === "123456")
    )
      unsupported(
        "Use the local email sign-in challenge and code 123456; other outcomes have not been captured.",
      );
    const session = id();
    state.set("sessions", session, { ...demoUser, email: pending.email });
    state.delete("challenges", challenge!);
    setCookie(c, "websim_session", session, {
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    // The captured frontend initializes its user store from this readable cookie after sign-in.
    setCookie(c, "_user_attributes", JSON.stringify(demoUser), {
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
    return c.json({
      nextStepConfig: { closeModal: {} },
      authentication: {
        userId: demoUser.id,
        isNewAccount: false,
        userId_str: demoUser.id_str,
      },
    });
  });
  routes.get("/api/v3/Header/:hash", (c) => {
    const session = getCookie(c, "websim_session");
    if (session && c.get("simulation").state.get("sessions", session))
      return c.json(header);
    deleteCookie(c, "websim_session", { path: "/", secure: true });
    deleteCookie(c, "_user_attributes", { path: "/", secure: true });
    return c.json(guestHeader);
  });
  routes.post("/api/v2/client_configs", async (c, next) => {
    const session = getCookie(c, "websim_session");
    const user = session && c.get("simulation").state.get("sessions", session);
    if (!user) return next();
    const body = await c.req.json<{ configs: string[] }>();
    if (!body.configs.includes("user")) return next();
    return c.json({
      time_stamp: Math.floor(c.get("simulation").clock.now().getTime() / 1000),
      user_attributes: demoUser,
    });
  });
  return routes;
}

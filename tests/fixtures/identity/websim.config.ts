import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie } from "hono/cookie";
import { defineSimulation, type SimulationEnv } from "../../../src/index.js";

const website = new Hono<SimulationEnv>();
website.get("/", (c) => {
  const session = getCookie(c, "session");
  const user = session && c.get("simulation").state.get("sessions", session);
  return c.html(
    user
      ? '<h1>Signed in</h1><a href="/account" target="_blank">Account</a><script>navigator.serviceWorker.register("/worker.js")</script>'
      : '<h1>Signed out</h1><a href="/login" target="_blank">Sign in</a><script>navigator.serviceWorker.register("/worker.js")</script>',
  );
});
website.get("/worker.js", (c) =>
  c.body(
    `
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', event => {
    if (new URL(event.request.url).pathname === '/worker-account')
      event.respondWith(fetch('/account').then(response => new Response(response.body, {status: response.status, headers: response.headers})));
  });
`,
    200,
    { "content-type": "application/javascript" },
  ),
);
website.get("/login", (c) => {
  const { state, id } = c.get("simulation");
  const nonce = id();
  state.set("pending", nonce, true);
  setCookie(c, "nonce", nonce, {
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
  return c.redirect(`https://identity.example/authorize?state=${nonce}`);
});
website.get("/callback", (c) => {
  const { state, id } = c.get("simulation");
  const nonce = getCookie(c, "nonce");
  const code = c.req.query("code");
  if (!nonce || !code || state.get("codes", code) !== nonce)
    return c.text("Invalid sign-in", 401);
  state.delete("codes", code);
  state.delete("pending", nonce);
  const session = id();
  state.set("sessions", session, { name: "Test traveler" });
  setCookie(c, "session", session, {
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
  setCookie(c, "currency", "USD", { secure: true, sameSite: "Lax", path: "/" });
  return c.redirect("/", 303);
});
website.get("/account", (c) => {
  const session = getCookie(c, "session");
  const user = session && c.get("simulation").state.get("sessions", session);
  return user ? c.html("<h1>Your account</h1>") : c.redirect("/");
});
website.get("/favicon.ico", (c) => c.body(null, 204));

const identity = new Hono<SimulationEnv>();
identity.get("/authorize", (c) => {
  const nonce = c.req.query("state");
  if (!nonce || !c.get("simulation").state.get("pending", nonce))
    return c.text("Invalid sign-in", 400);
  return c.html(`<h1>Verify your email</h1><form method="post" action="/verify">
    <input type="hidden" name="state" value="${nonce}">
    <label>Code<input name="code"></label><button>Continue</button></form>`);
});
identity.post("/verify", (c) => c.redirect("/exchange", 307));
identity.post("/exchange", async (c) => {
  const form = await c.req.parseBody();
  const { state, id } = c.get("simulation");
  const nonce = String(form.state);
  if (form.code !== "123456" || !state.get("pending", nonce))
    throw new HTTPException(401, { message: "Invalid code" });
  const code = id();
  state.set("codes", code, nonce);
  return c.redirect(`https://travel.example/callback?code=${code}`, 303);
});
identity.get("/favicon.ico", (c) => c.body(null, 204));

export default defineSimulation({
  name: "Cross-origin authentication fixture",
  description:
    "Owned fixture for browser redirects, cookies and instance isolation.",
  entrypoint: "https://travel.example/",
  modules: [
    { name: "website", origin: "https://travel.example", routes: website },
    { name: "identity", origin: "https://identity.example", routes: identity },
  ],
  scenarios: { guest: { description: "Signed out" } },
  defaultScenario: "guest",
});

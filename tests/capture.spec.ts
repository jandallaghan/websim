import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureServer } from "node:http2";
import { createServer } from "node:https";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { WebSocketServer } from "ws";
import { test, expect } from "@playwright/test";
import { startCapture, importCapture } from "../src/capture/index.js";
import { startServer } from "../src/server/server.js";
import {
  defineSimulation,
  WebsimClient,
  createBrowserSession,
} from "../src/index.js";

// A real Chrome process performs the capture. Playwright is used only after the origin is offline.
test("capture encrypted Chrome traffic, import HTTP/1 and multiplexed HTTP/2, and replay offline", async ({
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "websim-packets-"));
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ]);
  const tls = {
    key: await readFile(join(directory, "key.pem")),
    cert: await readFile(join(directory, "cert.pem")),
  };
  const binary = Buffer.from(Array.from({ length: 80_000 }, (_, i) => i % 256));
  const upload = Buffer.from([0, 255, 128, 1, 2]);
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const h1 = createServer(tls, (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    if (req.url === "/truncated") {
      res.writeHead(200, { "content-length": "1000" });
      res.write("partial");
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/binary" });
      res.end();
      return;
    }
    if (req.url === "/empty") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("content-encoding", "gzip");
    res.write(gzipSync(binary).subarray(0, 20));
    setTimeout(() => res.end(gzipSync(binary).subarray(20)), 20);
  });
  const sockets = new WebSocketServer({ server: h1, perMessageDeflate: false });
  sockets.on("connection", (socket) =>
    socket.on("message", (data, isBinary) =>
      socket.send(data, { binary: isBinary }),
    ),
  );
  await new Promise<void>((resolve) => h1.listen(0, "127.0.0.1", resolve));
  const h1Port = (h1.address() as { port: number }).port;
  const html = `<!doctype html><h1>Captured shop</h1><output>loading</output><script>
    (async () => {
      const results = await Promise.all([
        fetch('/upload', {method:'POST', body:new Uint8Array([0,255,128,1,2])}).then(r=>r.arrayBuffer()),
        fetch('/asset').then(r=>r.arrayBuffer()),
        fetch('https://127.0.0.1:${h1Port}/binary').then(r=>r.arrayBuffer()),
        fetch('https://127.0.0.1:${h1Port}/redirect', {redirect:'manual'}),
        fetch('https://127.0.0.1:${h1Port}/empty').then(r=>r.text()),
        fetch('https://127.0.0.1:${h1Port}/truncated').then(r=>r.arrayBuffer()).catch(()=>null)
      ]);
      document.querySelector('output').textContent = results.slice(0,3).map(b=>b.byteLength).join(',');
      const socket = new WebSocket('wss://127.0.0.1:${h1Port}/socket');
      await new Promise((resolve,reject) => { socket.onopen=()=>socket.send('stock:123'); let messages=0; socket.onmessage=()=>{ if (++messages === 1) socket.send(new Uint8Array([0,255,128])); else {socket.close();resolve();} }; socket.onerror=reject; });
      await fetch('/done');
    })().catch(e=>fetch('/failed?error='+encodeURIComponent(e.message)));
  </script>`;
  let failure: string | undefined;
  const h2 = createSecureServer(tls);
  h2.on("request", (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("cache-control", "no-store");
      if (req.url === "/") {
        res.setHeader("content-type", "text/html");
        res.end(html);
      } else if (req.url === "/asset" || req.url === "/upload") {
        const body = brotliCompressSync(
          req.url === "/asset" ? binary : Buffer.concat(chunks),
        );
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("content-encoding", "br");
        res.setHeader("content-length", String(body.length));
        res.write(body.subarray(0, 10));
        setTimeout(() => res.end(body.subarray(10)), 30);
      } else {
        res.end("ok");
        if (req.url?.startsWith("/failed")) failure = req.url;
        if (req.url === "/done" || failure) setTimeout(finish, 200);
      }
    });
  });
  await new Promise<void>((resolve) => h2.listen(0, "127.0.0.1", resolve));
  const h2Port = (h2.address() as { port: number }).port;
  const url = `https://127.0.0.1:${h2Port}/`;
  const capture = await startCapture({
    url,
    directory: join(directory, "capture"),
    interfaces: [process.platform === "darwin" ? "lo0" : "lo"],
    filter: `tcp port ${h1Port} or tcp port ${h2Port}`,
    chromePath: process.env.WEBSIM_TEST_CHROME,
    chromeArgs: [
      "--headless=new",
      "--no-sandbox",
      "--ignore-certificate-errors",
    ],
  });
  try {
    await Promise.race([
      finished,
      capture.browserClosed.then(() => {
        throw new Error("Chrome exited before completing the workflow");
      }),
    ]);
    expect(failure).toBeUndefined();
    const archive = await capture.stop();
    await Promise.all([
      new Promise<void>((resolve) => h1.close(() => resolve())),
      new Promise<void>((resolve) => h2.close(() => resolve())),
    ]);
    await cp(join(directory, "capture"), test.info().outputPath("capture"), {
      recursive: true,
    });
    const entries = archive.manifest.entries;
    const entry = (path: string) =>
      entries.find((e) => new URL(e.url).pathname === path)!;
    expect((await archive.body(entry("/"))).toString()).toBe(html);
    expect(new Set(entries.map((e) => e.protocol))).toEqual(
      new Set(["http/1.1", "h2"]),
    );
    expect((await archive.body(entry("/asset"))).equals(binary)).toBe(true);
    expect((await archive.body(entry("/binary"))).equals(binary)).toBe(true);
    expect(await archive.body(entry("/upload"))).toEqual(upload);
    expect(Buffer.from(entry("/upload").requestBodyBase64!, "base64")).toEqual(
      upload,
    );
    expect(entry("/redirect").status).toBe(302);
    expect(entry("/redirect").responseHeaders.location).toBe("/binary");
    expect(entry("/empty").status).toBe(204);
    expect(entry("/socket").status).toBe(101);
    expect(
      entry("/socket").responseHeaders["sec-websocket-accept"],
    ).toBeTruthy();
    expect(
      archive.manifest.websocketFrames
        .filter((frame) => frame.opcode === 1)
        .map((frame) => [
          frame.direction,
          Buffer.from(frame.payloadBase64, "base64").toString(),
        ]),
    ).toEqual([
      ["sent", "stock:123"],
      ["received", "stock:123"],
    ]);
    expect(
      archive.manifest.websocketFrames
        .filter((frame) => frame.opcode === 2)
        .map((frame) => [frame.direction, frame.payloadBase64]),
    ).toEqual([
      ["sent", "AP+A"],
      ["received", "AP+A"],
    ]);
    expect(entry("/truncated")).toBeUndefined();
    expect(
      archive.manifest.warnings.some(
        (warning) =>
          warning.includes("/truncated") &&
          /Incomplete|no captured request/.test(warning),
      ),
    ).toBe(true);
    expect(
      archive.manifest.warnings.filter(
        (warning) =>
          !warning.includes("WebSocket") && !warning.includes("/truncated"),
      ),
    ).toEqual([]);
    expect(await capture.stop()).toBe(archive);

    // The raw evidence can be re-imported independently; a missing key log cannot silently succeed.
    const imported = await importCapture({
      pcap: capture.pcap,
      keyLog: capture.keyLog,
      directory: join(directory, "imported"),
    });
    expect(imported.manifest.entries.map((e) => e.bodyHash)).toEqual(
      entries.map((e) => e.bodyHash),
    );
    await writeFile(join(directory, "wrong.keys"), "");
    await expect(
      importCapture({
        pcap: capture.pcap,
        keyLog: join(directory, "wrong.keys"),
        directory: join(directory, "invalid"),
      }),
    ).rejects.toThrow("No complete HTTP exchanges");
    const server = await startServer(
      defineSimulation({
        name: "Captured",
        description: "",
        entrypoint: url,
        captures: [archive],
        modules: [],
        seeds: { default: { description: "", apply() {} } },
        defaultSeed: "default",
      }),
    );
    const instance = await new WebsimClient(server).createInstance();
    const session = await createBrowserSession(browser, instance);
    try {
      const page = await session.context.newPage();
      // HTTP works offline, including the redirect and both compressed binary representations.
      await page.goto(url);
      await expect(page.locator("output")).toHaveText("5,80000,80000");
      // WebSocket simulation remains explicitly unsupported, even though capture retains its frames.
      await expect
        .poll(async () =>
          (await instance.inspect()).diagnostics.some(
            (d) => d.code === "UNSUPPORTED_BEHAVIOR",
          ),
        )
        .toBe(true);
    } finally {
      await session.context.close();
      await server.close();
    }
  } finally {
    await capture.stop().catch(() => undefined);
    for (const client of sockets.clients) client.terminate();
    sockets.close();
    h1.close();
    h2.close();
    await rm(directory, { recursive: true, force: true });
  }
});

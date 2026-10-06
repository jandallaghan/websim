import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  startSandbox,
  WebsimClient,
  createBrowserSession,
} from "../src/index.js";
const execute = promisify(execFile);
const image = "websim-sandbox:local";

test("sealed runner supports independent scenario state while blocking browser and runtime network bypasses", async () => {
  test.setTimeout(90_000);
  const witness = `websim-witness-${randomBytes(6).toString("hex")}`;
  const sandbox = await startSandbox({
    config: "tests/fixtures/account/websim.config.ts",
  });
  try {
    // A reachable receiver is the positive control: an unreachable public URL is not evidence of isolation.
    await execute("docker", [
      "run",
      "-d",
      "--name",
      witness,
      "--entrypoint",
      "node",
      image,
      "-e",
      `
      require('node:http').createServer((q,s)=>{console.log('TCP '+q.url);s.end('reached')}).listen(8080,'0.0.0.0');
      const udp=require('node:dgram').createSocket('udp4');udp.on('message',()=>console.log('UDP'));udp.bind(5353,'0.0.0.0');
    `,
    ]);
    const { stdout } = await execute("docker", [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      witness,
    ]);
    const ip = stdout.trim();
    const probe = `
      const net=require('node:net'),udp=require('node:dgram').createSocket('udp4');
      Promise.all([
        fetch('http://${ip}:8080/probe',{signal:AbortSignal.timeout(1500)}).then(r=>r.text()).catch(()=> 'blocked'),
        new Promise(r=>{ const s=net.connect(8080,'${ip}');s.on('connect',()=>{s.end();r('connected')});s.on('error',()=>r('blocked'));s.setTimeout(1500,()=>{s.destroy();r('blocked')}) }),
        new Promise(r=>udp.send(Buffer.from('probe'),5353,'${ip}',e=>{udp.close();r(e?'blocked':'sent')}))
      ]).then(x=>console.log(JSON.stringify(x)));
    `;
    const positive = await execute("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "node",
      image,
      "-e",
      probe,
    ]);
    expect(JSON.parse(positive.stdout)).toEqual([
      "reached",
      "connected",
      "sent",
    ]);
    const before = (await execute("docker", ["logs", witness])).stdout;
    const blocked = await execute("docker", [
      "exec",
      sandbox.container,
      "node",
      "-e",
      probe,
    ]);
    expect(JSON.parse(blocked.stdout)).toEqual([
      "blocked",
      "blocked",
      "blocked",
    ]);
    const browser = await sandbox.connectBrowser();
    try {
      const raw = await browser.newContext(); // Deliberately no Websim routes, including no WebSocket interception.
      const page = await raw.newPage();
      await expect(
        page.goto(`http://${ip}:8080/browser`, { timeout: 3000 }),
      ).rejects.toThrow();
      await page.goto("about:blank");
      const socket = await page.evaluate(
        (url) =>
          new Promise((resolve) => {
            const ws = new WebSocket(url);
            ws.onerror = () => resolve("blocked");
            ws.onopen = () => {
              ws.close();
              resolve("connected");
            };
            setTimeout(() => {
              ws.close();
              resolve("blocked");
            }, 2000);
          }),
        `ws://${ip}:8080/socket`,
      );
      expect(socket).toBe("blocked");
      await expect(
        page.goto("https://example.com", { timeout: 3000 }),
      ).rejects.toThrow();
      await raw.close();
      expect((await execute("docker", ["logs", witness])).stdout).toBe(before);
      const client = new WebsimClient(sandbox);
      const first = await client.createInstance({ scenario: "funded" });
      const second = await client.createInstance({ scenario: "empty" });
      const session = await createBrowserSession(browser, first);
      const bank = await session.context.newPage();
      await bank.goto("https://north.example/");
      await bank.getByLabel("Amount in GBP").fill("50");
      await bank.getByRole("button", { name: "Add money" }).click();
      await expect(bank.getByLabel("Balance")).toHaveText("£150.00");
      expect(await second.readState("accounts", "main")).toEqual({
        balance: 0,
      });
      await first.reset();
      await bank.reload();
      await expect(bank.getByLabel("Balance")).toHaveText("£100.00");
      await session.close();
    } finally {
      await browser.close();
    }
    const config = JSON.parse(
      (await execute("docker", ["inspect", sandbox.container])).stdout,
    )[0];
    expect(config.HostConfig.NetworkMode).toBe("none");
    expect(config.HostConfig.CapDrop).toContain("ALL");
    expect(config.HostConfig.ReadonlyRootfs).toBe(true);
    expect(config.Mounts).toEqual([]);
  } finally {
    await sandbox.close();
    await execute("docker", ["rm", "-f", witness]).catch(() => undefined);
  }
});

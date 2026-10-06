import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { openTunnel } from "./tunnel.js";
const execute = promisify(execFile);
export interface SandboxOptions {
  image?: string;
  config: string;
  port?: number;
  token?: string;
}

/** Start a sealed browser/runtime environment from an already-built simulation image. */
export async function startSandbox(options: SandboxOptions) {
  const token = options.token ?? randomBytes(32).toString("hex");
  const container = `websim-${randomBytes(8).toString("hex")}`;
  const tunnels: Awaited<ReturnType<typeof openTunnel>>[] = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await Promise.all(tunnels.map((tunnel) => tunnel.close()));
    } finally {
      await execute("docker", ["rm", "-f", container]);
    }
  };
  try {
    await execute("docker", [
      "run",
      "-d",
      "--name",
      container,
      "--label",
      "dev.websim.sandbox=true",
      "--network",
      "none",
      "--dns",
      "127.0.0.1",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=512m",
      "--shm-size",
      "256m",
      "--memory",
      "2g",
      "--cpus",
      "2",
      "--pids-limit",
      "256",
      "--init",
      "-e",
      `WEBSIM_TOKEN=${token}`,
      options.image ?? "websim-sandbox:local",
      options.config,
    ]);
    const management = await openTunnel(container, 4100, options.port);
    tunnels.push(management);
    const url = `http://127.0.0.1:${management.port}`;
    let ready: { browserPath: string } | undefined;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${url}/api/sandbox`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = (await response.json()) as { browserPath: string };
          break;
        }
      } catch {
        /* Worker startup is bounded by the deadline. */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) {
      const logs = await execute("docker", ["logs", container]);
      throw new Error(
        `Sandbox did not become ready:\n${logs.stdout}${logs.stderr}`,
      );
    }
    const control = await openTunnel(container, 4101);
    tunnels.push(control);
    const browserEndpoint = `ws://127.0.0.1:${control.port}${ready.browserPath}`;
    return {
      url,
      token,
      container,
      browserEndpoint,
      connectBrowser: () => chromium.connect(browserEndpoint),
      [Symbol.asyncDispose]: close,
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

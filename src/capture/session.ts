import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { executable, launch } from "./process.js";
import { importCapture, type ImportOptions } from "./import.js";
import type { CaptureArchive } from "./archive.js";

export interface CaptureOptions extends Omit<ImportOptions, "pcap" | "keyLog"> {
  url: string;
  interfaces?: string[];
  filter?: string;
  chromePath?: string;
  dumpcapPath?: string;
  /** Extra Chrome arguments, for example certificate trust configuration for a local test site. */
  chromeArgs?: string[];
}
export interface CaptureSession {
  directory: string;
  pcap: string;
  keyLog: string;
  /** Resolves when Chrome exits; capture can also be stopped explicitly. */
  browserClosed: Promise<void>;
  stop(): Promise<CaptureArchive>;
  [Symbol.asyncDispose](): Promise<void>;
}
async function chromeExecutable(path?: string) {
  if (path) {
    await access(path);
    return path;
  }
  if (process.platform === "darwin") {
    const chrome =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(chrome);
      return chrome;
    } catch {
      throw new Error("Install Google Chrome or supply chromePath.");
    }
  }
  for (const name of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ]) {
    try {
      return await executable(name);
    } catch {
      /* Try the next browser. */
    }
  }
  throw new Error("Install Google Chrome or supply chromePath.");
}
async function defaultInterfaces(): Promise<string[]> {
  if (process.platform === "linux") return ["any"];
  const { stdout } = await promisify(execFile)("/sbin/route", [
    "-n",
    "get",
    "default",
  ]);
  const network = stdout.match(/interface:\s*(\S+)/)?.[1];
  if (!network)
    throw new Error(
      "Cannot determine the network interface. Supply interfaces explicitly.",
    );
  return [...new Set([network, "lo0"])];
}

/** Record ordinary Chrome without a debugging connection, automation driver or TLS proxy. */
export async function startCapture(
  options: CaptureOptions,
): Promise<CaptureSession> {
  if (!["darwin", "linux"].includes(process.platform))
    throw new Error(
      "Live capture currently supports macOS and Linux. Import existing PCAPs with importCapture on other platforms.",
    );
  if (!["http:", "https:"].includes(new URL(options.url).protocol))
    throw new Error("Capture URL must use HTTP or HTTPS.");
  const [chrome, dumpcap, tshark, interfaces] = await Promise.all([
    chromeExecutable(options.chromePath),
    executable("dumpcap", options.dumpcapPath),
    executable("tshark", options.tsharkPath),
    options.interfaces ?? defaultInterfaces(),
  ]);
  if (!interfaces.length)
    throw new Error("At least one capture interface is required.");
  const directory = resolve(options.directory);
  // A session owns its directory. Never silently merge recordings or reuse a browser profile.
  await mkdir(directory, { recursive: false, mode: 0o700 }).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST")
        throw new Error(
          `Capture directory already exists: ${directory}. Choose a new directory; recordings are never merged.`,
        );
      if (error.code !== "ENOENT") throw error;
      await mkdir(resolve(directory, ".."), { recursive: true });
      await mkdir(directory, { mode: 0o700 });
    },
  );
  const raw = join(directory, "raw");
  await mkdir(raw, { mode: 0o700 });
  const pcap = join(raw, "traffic.pcapng");
  const keyLog = join(raw, "tls.keys");
  await writeFile(keyLog, "", { mode: 0o600 });
  const profile = await mkdtemp(join(tmpdir(), "websim-chrome-"));
  const recorder = launch(dumpcap, [
    "-q",
    "-p",
    "-B",
    "64",
    "-f",
    options.filter ?? "tcp",
    ...interfaces.flatMap((name) => ["-i", name]),
    "-w",
    pcap,
  ]);
  recorder.child.stdout.resume();
  let browser: ReturnType<typeof launch> | undefined;
  try {
    // Wait until dumpcap has actually opened its output before any browser traffic begins.
    let waiting = true;
    try {
      await Promise.race([
        (async () => {
          for (let attempt = 0; waiting && attempt < 100; attempt++) {
            if (
              await stat(pcap).then(
                (file) => file.size >= 28,
                () => false,
              )
            )
              return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(
            `Packet capture did not become ready. ${recorder.diagnostics()}`,
          );
        })(),
        recorder.exited.then(() => {
          throw new Error(
            `Cannot start packet capture. ${recorder.diagnostics()} Check dumpcap capture permissions.`,
          );
        }),
      ]);
    } finally {
      waiting = false;
    }
    browser = launch(
      chrome,
      [
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-quic",
        ...(options.chromeArgs ?? []),
        options.url,
      ],
      { ...process.env, SSLKEYLOGFILE: keyLog },
    );
    browser.child.stdout.resume();
    const ownedBrowser = browser;
    let stopRequested = false;
    const captureEnded = recorder.exited.then(() => {
      if (!stopRequested)
        throw new Error(
          `Packet capture stopped unexpectedly. ${recorder.diagnostics()}`,
        );
    });
    void captureEnded.catch(() => undefined);
    const browserClosed = Promise.race([
      ownedBrowser.exited.then(({ code, signal }) => {
        if (code || (signal && !stopRequested))
          throw new Error(
            `Chrome exited unexpectedly (${code ?? signal}). ${ownedBrowser.diagnostics()}`,
          );
      }),
      captureEnded,
    ]);
    void browserClosed.catch(() => undefined);
    let stopping: Promise<CaptureArchive> | undefined;
    return {
      directory,
      pcap,
      keyLog,
      browserClosed,
      async [Symbol.asyncDispose](this: CaptureSession) {
        await this.stop();
      },
      stop() {
        stopRequested = true;
        return (stopping ??= (async () => {
          try {
            const browserResult = await ownedBrowser.stop();
            // libpcap can deliver the last batch up to a read timeout after Chrome exits.
            await new Promise((resolve) => setTimeout(resolve, 1100));
            const result = await recorder.stop("SIGINT");
            if (result.code !== 0 && result.signal !== "SIGINT")
              throw new Error(
                `Packet capture failed: ${recorder.diagnostics()}`,
              );
            await captureEnded;
            if (browserResult.code || browserResult.signal === "SIGKILL")
              throw new Error(
                `Chrome did not stop cleanly. Raw evidence is retained in ${raw}. ${ownedBrowser.diagnostics()}`,
              );
            const archive = await importCapture({
              ...options,
              directory,
              pcap,
              keyLog,
              tsharkPath: tshark,
            });
            if (
              /received\/dropped[^\n]*: \d+\/[1-9]\d*|[1-9]\d* packets dropped/i.test(
                recorder.diagnostics(),
              )
            ) {
              archive.manifest.warnings.push(
                `Capture statistics: ${recorder.diagnostics()}`,
              );
              await archive.save();
            }
            return archive;
          } finally {
            await recorder.stop("SIGINT").catch(() => undefined);
            await rm(profile, { recursive: true, force: true });
          }
        })());
      },
    };
  } catch (error) {
    await Promise.allSettled([browser?.stop(), recorder.stop("SIGINT")]);
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

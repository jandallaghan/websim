import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";

export async function executable(
  name: string,
  override?: string,
): Promise<string> {
  const filename = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = override
    ? [override]
    : [
        ...(process.env.PATH ?? "")
          .split(delimiter)
          .map((path) => join(path, filename)),
        ...(process.platform === "darwin"
          ? [`/Applications/Wireshark.app/Contents/MacOS/${name}`]
          : []),
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next installation. */
    }
  }
  throw new Error(
    `Cannot find ${override ?? name}. Install Wireshark (including dumpcap and tshark), or supply its executable path.`,
  );
}

/** Always drain stderr, retain a bounded diagnostic, and observe spawn errors immediately. */
export function launch(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_384);
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  void exited.catch(() => undefined);
  return {
    child,
    exited,
    diagnostics: () => stderr,
    async stop(signal: NodeJS.Signals = "SIGTERM") {
      if (child.exitCode === null && child.signalCode === null)
        child.kill(signal);
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        return await exited;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

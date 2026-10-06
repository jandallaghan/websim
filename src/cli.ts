#!/usr/bin/env node
import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { Command } from "commander";
import {
  inspectCapture,
  printCaptureSummary,
  type InspectOptions,
} from "./cli/inspect.js";

import { startWorkspace } from "./workspace/server.js";

import { startCapture, importCapture } from "./capture/index.js";

const program = new Command()
  .name("websim")
  .description("Capture, run, and inspect stateful website simulations.")
  .version("0.1.0");
program
  .command("dev")
  .argument(
    "[directory]",
    "Directory containing simulation configurations",
    ".",
  )
  .option("-p, --port <port>", "Management port", "4100")
  .option("--image <image>", "Use an already-built simulation image")
  .action(
    async (directory: string, options: { port: string; image?: string }) => {
      const image = options.image ?? "websim-sandbox:local";
      if (!options.image) {
        console.log("Building the simulation image…");
        await new Promise<void>((resolve, reject) => {
          const build = spawn(
            "docker",
            ["build", "-f", "docker/Dockerfile", "-t", image, "."],
            { stdio: "inherit" },
          );
          build.once("error", reject);
          build.once("exit", (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`Docker build failed (${code})`)),
          );
        });
      }
      const server = await startWorkspace({
        image,
        directory,
        port: Number(options.port),
      });
      console.log(
        `\nWebsim is running\n\n  Inspector: ${server.url}/ui/\n\nPress Ctrl+C to stop.\n`,
      );
      let closing = false;
      const close = async (): Promise<void> => {
        if (closing) return;
        closing = true;
        await server.close();
      };
      process.once("SIGINT", () => {
        void close();
      });
      process.once("SIGTERM", () => {
        void close();
      });
    },
  );
program
  .command("capture")
  .argument("<url>")
  .requiredOption("-o, --output <directory>", "New capture directory")
  .option("-n, --name <name>", "Capture name")
  .option(
    "-i, --interface <name...>",
    "Capture interfaces (default: active network and loopback)",
  )
  .option("--chrome <path>", "Chrome executable")
  .option("--filter <expression>", "Packet capture filter", "tcp")
  .description("Record ordinary Chrome with packet capture and TLS-key logging")
  .action(
    async (
      url: string,
      options: {
        output: string;
        name?: string;
        interface?: string[];
        chrome?: string;
        filter: string;
      },
    ) => {
      const session = await startCapture({
        url,
        directory: options.output,
        name: options.name,
        interfaces: options.interface,
        chromePath: options.chrome,
        filter: options.filter,
      });
      const terminal = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let interrupted!: () => void;
      const signal = new Promise<void>((resolve) => {
        interrupted = resolve;
      });
      process.once("SIGINT", interrupted);
      process.once("SIGTERM", interrupted);
      terminal.once("SIGINT", interrupted);
      try {
        console.log(
          "Recording Chrome. Raw packets and TLS keys are stored locally under raw/.",
        );
        await Promise.race([
          terminal.question(
            "Browse the workflow, then press Enter here or quit the capture Chrome to save.\n",
          ),
          session.browserClosed,
          signal,
        ]);
      } finally {
        terminal.close();
        process.removeListener("SIGINT", interrupted);
        process.removeListener("SIGTERM", interrupted);
        console.log("Decoding captured traffic…");
        const archive = await session.stop();
        printCaptureSummary(archive);
      }
    },
  );
program
  .command("import")
  .requiredOption("--pcap <file>", "Recorded PCAP or PCAPNG")
  .requiredOption("--keys <file>", "Chrome TLS key log")
  .requiredOption(
    "-o, --output <directory>",
    "Archive directory without an existing manifest",
  )
  .option("-n, --name <name>", "Capture name")
  .description("Decode an existing packet recording into a simulation archive")
  .action(
    async (options: {
      pcap: string;
      keys: string;
      output: string;
      name?: string;
    }) => {
      const archive = await importCapture({
        pcap: options.pcap,
        keyLog: options.keys,
        directory: options.output,
        name: options.name,
      });
      printCaptureSummary(archive);
    },
  );
program
  .command("inspect")
  .argument("<directory>", "Capture archive directory")
  .option("--url <text>", "List exchanges whose URL contains this text")
  .option("--entry <id>", "Read one exchange, including its response body")
  .option("--warnings", "Read import warnings")
  .description(
    "Inspect capture evidence as JSON; defaults to an origin summary",
  )
  .action(async (directory: string, options: InspectOptions) => {
    if (
      [options.url !== undefined, !!options.entry, !!options.warnings].filter(
        Boolean,
      ).length > 1
    )
      throw new Error("Choose one of --url, --entry, or --warnings.");
    console.log(
      JSON.stringify(await inspectCapture(directory, options), null, 2),
    );
  });
program
  .command("init")
  .argument("<directory>")
  .argument("<url>")
  .description("Create a capture-backed TypeScript simulation")
  .action(async (directory: string, url: string) => {
    const entrypoint = new URL(url).href;
    await mkdir(directory, { recursive: true });
    const config = `import { defineSimulation } from "@websim/core";
import { CaptureArchive } from "@websim/core/capture";
import { fileURLToPath } from "node:url";

export default async function simulation() {
  const capture = await CaptureArchive.open(
    fileURLToPath(new URL("./captures/session", import.meta.url)),
  );
  return defineSimulation({
    name: ${JSON.stringify(basename(resolve(directory)))},
    description: "",
    entrypoint: ${JSON.stringify(entrypoint)},
    captures: [capture],
    modules: [],
    scenarios: {
      default: { description: "Recorded workflow" },
    },
    defaultScenario: "default",
  });
}
`;
    await writeFile(resolve(directory, "websim.config.ts"), config, {
      flag: "wx",
    });
    console.log(
      `Created ${directory}/websim.config.ts\nNext: websim capture ${entrypoint} --output ${directory}/captures/session`,
    );
  });
await program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

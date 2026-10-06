import { readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep, basename } from "node:path";

export interface SimulationEntry {
  id: string;
  name: string;
  config: string;
}
const excluded = new Set([
  "node_modules",
  ".git",
  ".websim",
  "dist",
  "build",
  "captures",
  "test-results",
  "playwright-report",
  "tests",
]);

/** Discover config paths without executing simulation code on the host. */
export async function discoverSimulations(
  directory: string,
  projectRoot: string,
): Promise<SimulationEntry[]> {
  const root = await realpath(projectRoot);
  const start = await realpath(directory);
  const inside = relative(root, start);
  if (inside === ".." || inside.startsWith(`..${sep}`))
    throw new Error(
      "Workspace directory must be inside the image build context.",
    );
  const result: SimulationEntry[] = [];
  async function visit(path: string) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name === "websim.config.ts") {
        const config = relative(root, resolve(path, entry.name))
          .split(sep)
          .join("/");
        result.push({
          id: Buffer.from(config).toString("base64url"),
          name: basename(path),
          config,
        });
      }
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !excluded.has(entry.name)
      )
        await visit(resolve(path, entry.name));
    }
  }
  await visit(start);
  return result.sort((a, b) => a.config.localeCompare(b.config));
}

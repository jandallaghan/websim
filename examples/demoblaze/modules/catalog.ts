import { Hono } from "hono";
import { z } from "zod";
import type { CaptureArchive } from "../../../src/capture/index.js";
import type { SimulationEnv } from "../../../src/index.js";

const productSchema = z.object({
  id: z.number(),
  title: z.string(),
  price: z.number(),
  img: z.string(),
  desc: z.string(),
  cat: z.string(),
});
export type Product = z.infer<typeof productSchema>;
export async function readProducts(
  archive: CaptureArchive,
): Promise<Product[]> {
  const products = new Map<number, Product>();
  for (const entry of archive.manifest.entries) {
    if (
      !["/entries", "/bycat", "/pagination"].includes(
        new URL(entry.url).pathname,
      ) ||
      entry.status !== 200
    )
      continue;
    const data = JSON.parse((await archive.body(entry)).toString());
    for (const value of data.Items ?? []) {
      const product = productSchema.parse(value);
      products.set(product.id, product);
    }
  }
  if (!products.size)
    throw new Error("No catalog captured. Run npm run capture:demo first.");
  return [...products.values()].sort((a, b) => a.id - b.id);
}
export function catalogRoutes(products: Product[]): Hono<SimulationEnv> {
  const app = new Hono<SimulationEnv>();
  const page = (items: Product[]) => ({
    Items: items,
    Count: items.length,
    ScannedCount: items.length,
    LastEvaluatedKey: { id: items.at(-1)?.id ?? 0 },
  });
  app.get("/entries", (c) => c.json(page(products.slice(0, 9))));
  app.post("/pagination", async (c) => {
    const { id } = await c.req.json();
    return c.json(
      page(products.filter((product) => product.id > Number(id)).slice(0, 9)),
    );
  });
  app.post("/bycat", async (c) => {
    const { cat } = await c.req.json();
    return c.json(page(products.filter((product) => product.cat === cat)));
  });
  app.post("/view", async (c) => {
    const { id } = await c.req.json();
    const product = products.find((product) => product.id === Number(id));
    return product
      ? c.json(product)
      : c.json({ errorMessage: "Product does not exist." }, 404);
  });
  return app;
}

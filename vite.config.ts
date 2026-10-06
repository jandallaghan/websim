import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  root: "ui",
  plugins: [tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./ui", import.meta.url)) } },
  base: "/ui/",
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    rolldownOptions: {
      onwarn(warning, warn) {
        // This is a client-only app; React Server Component boundaries do not apply.
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes("use client")
        )
          return;
        warn(warning);
      },
    },
  },
});

import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  security: {
    // We enforce CSRF explicitly in middleware + API handlers.
    // Disable Astro origin gate to avoid false 403 on same-origin multipart POST.
    checkOrigin: false,
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ["sql.js"],
    },
  },
});

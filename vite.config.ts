import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Tests import the Worker directly; the Cloudflare dev runtime is only for dev and build.
  plugins: [react(), tailwindcss(), process.env.VITEST ? [] : cloudflare()],
  resolve: process.env.VITEST ? { alias: { "cloudflare:workers": fileURLToPath(new URL("./worker/test-stubs/cloudflare-workers.ts", import.meta.url)) } } : {},
});

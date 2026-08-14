import { defineConfig } from "astro/config";
import node from "@astrojs/node";

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";
const webPort = Number(process.env.WEB_PORT ?? "4321");

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: {
    host: "127.0.0.1",
    port: webPort,
  },
  vite: {
    server: {
      strictPort: process.env.E2E_STRICT_PORT === "1",
      proxy: {
        "/api": apiOrigin,
      },
    },
  },
});

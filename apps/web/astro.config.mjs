import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { resolveDevStaticShellRoute } from "./src/lib/dev-static-shell-route.ts";

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";
const webPort = Number(process.env.WEB_PORT ?? "4321");

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // React runs only inside hydrated islands (ADR 0006); no page renders it
  // unless it mounts one.
  integrations: [react()],
  server: {
    host: "127.0.0.1",
    port: webPort,
  },
  vite: {
    plugins: [tailwindcss(), {
      name: "kinship-dev-static-shell-routes",
      apply: "serve",
      enforce: "pre",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const shellRoute = resolveDevStaticShellRoute(request.url);
          if (shellRoute) request.url = shellRoute;
          next();
        });
      },
    }],
    server: {
      strictPort: process.env.E2E_STRICT_PORT === "1",
      proxy: {
        "/api": apiOrigin,
      },
    },
  },
});

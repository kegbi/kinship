import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { resolveDevStaticShellRoute } from "./src/lib/dev-static-shell-route.ts";

/**
 * React's development preamble on every page (GAP-027). Astro adds it only
 * before an Astro `client:*` island hydrates, but the people palette and the
 * gifts island mount from page scripts (`mountIsland`), and in `astro dev`
 * every React module refuses to run without it. The build is unaffected.
 */
const reactRefreshPreamble = {
  name: "kinship-react-refresh-preamble",
  hooks: {
    "astro:config:setup": ({ command, injectScript }) => {
      if (command !== "dev") return;
      injectScript(
        "page",
        [
          'import { injectIntoGlobalHook } from "/@react-refresh";',
          "injectIntoGlobalHook(window);",
          "window.$RefreshReg$ = () => {};",
          "window.$RefreshSig$ = () => (type) => type;",
        ].join("\n"),
      );
    },
  },
};

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";
const webPort = Number(process.env.WEB_PORT ?? "4321");

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // React runs only inside hydrated islands (ADR 0006); no page renders it
  // unless it mounts one.
  integrations: [react(), reactRefreshPreamble],
  server: {
    host: "127.0.0.1",
    port: webPort,
  },
  vite: {
    build: {
      // Astro writes a small bundled page script into the HTML unless this
      // says no. The gateway's CSP allows inline scripts only by hash
      // (GAP-040), so every bundled script ships as a same-origin file and
      // the one inline script is the hand-written theme bootstrap. Other
      // assets keep Vite's default limit.
      assetsInlineLimit: (file) => (/\.m?js$/.test(file) ? false : undefined),
    },
    resolve: {
      // cmdk's unused Radix Command.Dialog stays out of the bundle; see
      // cmdk-radix-dialog.mjs.
      alias: [{
        find: /^@radix-ui\/react-dialog$/,
        replacement: fileURLToPath(
          new URL("./cmdk-radix-dialog.mjs", import.meta.url),
        ),
      }],
    },
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

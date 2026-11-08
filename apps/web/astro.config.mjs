import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { resolveDevStaticShellRoute } from "./src/lib/dev-static-shell-route.ts";
import { modulePreload } from "./src/lib/module-preload.ts";

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

/**
 * A renderer that needs no `node_modules` (ADR 0007, FER-03). The server
 * build bundles the few packages Astro would otherwise leave as imports
 * (React's server renderer, Zod, clsx), so the `web` image copies only the
 * build output, not the toolchain. Development keeps Vite's defaults.
 */
const selfContainedServer = {
  name: "kinship-self-contained-server",
  hooks: {
    "astro:config:setup": ({ command, updateConfig }) => {
      if (command !== "build") return;
      updateConfig({ vite: { ssr: { noExternal: true } } });
    },
  },
};

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";
const webPort = Number(process.env.WEB_PORT ?? "4321");

export default defineConfig({
  // ADR 0007: every page is prerendered unless it opts out with
  // `export const prerender = false`; only the page catalog's `on-demand`
  // routes (`/privacy` and `/terms`) do, and the Node adapter renders them.
  output: "static",
  adapter: node({ mode: "standalone" }),
  // React runs only inside hydrated islands (ADR 0006); no page renders it
  // unless it mounts one.
  integrations: [
    react(),
    reactRefreshPreamble,
    selfContainedServer,
    // Each built page preloads its scripts' static import closure (FER-02).
    // The person shell also preloads the islands it mounts as soon as the
    // person resolves — the hero, the rail summary, and the profile fact
    // sections the rail loads (features/person/section-mounts.ts) — so their
    // chunks do not wait for the profile read.
    modulePreload({
      extraEntries: {
        "internal/person-profile-shell/index.html": [
          "src/islands/person-hero/mount.tsx",
          "src/islands/person-rail/mount.tsx",
          "src/features/person/facts/contact-methods.tsx",
          "src/features/person/facts/addresses.tsx",
          "src/features/person/facts/work.tsx",
          "src/features/person/facts/pets.tsx",
          "src/features/person/facts/food.tsx",
          "src/features/person/facts/first-meeting.tsx",
          "src/features/person/facts/tags.tsx",
        ],
      },
    }),
  ],
  build: {
    // The gateway's CSP allows styles only from the origin (AUD-G3), so a
    // small stylesheet ships as a same-origin file, never a `<style>`
    // element in the HTML.
    inlineStylesheets: "never",
  },
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
    optimizeDeps: {
      // Islands mount from page scripts, which Vite's first dependency scan
      // misses. A dependency it then finds late is pre-bundled again, and a
      // page still asking for the old bundle gets "504 Outdated Optimize Dep"
      // and loses its whole script (the preferences page's theme stayed
      // "Loading…"). Naming them here bundles them once, up front.
      include: [
        "@base-ui/react/autocomplete",
        "@base-ui/react/avatar",
        "@base-ui/react/button",
        "@base-ui/react/combobox",
        "@base-ui/react/dialog",
        "@base-ui/react/input",
        "@base-ui/react/merge-props",
        "@base-ui/react/popover",
        "@base-ui/react/use-render",
        "@hookform/resolvers/zod",
        "class-variance-authority",
        "clsx",
        "cmdk",
        "lucide-react",
        "react-dom/client",
        "react-hook-form",
        "tailwind-merge",
        // Every `zod` import is aliased to `src/lib/zod-jitless.ts`, which
        // loads this.
        "zod/v4",
      ],
    },
    resolve: {
      // cmdk's unused Radix Command.Dialog stays out of the bundle; see
      // cmdk-radix-dialog.mjs. Every `zod` import resolves to the JIT-less
      // Zod the gateway's CSP needs (REL-069); see src/lib/zod-jitless.ts.
      alias: [{
        find: /^@radix-ui\/react-dialog$/,
        replacement: fileURLToPath(
          new URL("./cmdk-radix-dialog.mjs", import.meta.url),
        ),
      }, {
        find: /^zod$/,
        replacement: fileURLToPath(
          new URL("./src/lib/zod-jitless.ts", import.meta.url),
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

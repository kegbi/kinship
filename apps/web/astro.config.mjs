import { defineConfig } from "astro/config";

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

export default defineConfig({
  output: "static",
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  vite: {
    server: {
      proxy: {
        "/api": apiOrigin,
      },
    },
  },
});

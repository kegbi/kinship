import { app } from "./app.ts";

const DEFAULT_PORT = 8000;

export function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

if (import.meta.main) {
  Deno.serve(
    { hostname: "127.0.0.1", port: resolvePort(Deno.env.get("PORT")) },
    app.fetch,
  );
}

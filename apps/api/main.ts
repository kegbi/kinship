/**
 * The API entry point.
 *
 * It resolves a port and serves what the composition root assembled. Reading
 * the environment, decoding keysets, and building adapters all belong to
 * `composition.ts`, so nothing here knows what an adapter is.
 */

import { createApiRuntime } from "./composition.ts";

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
  const configured = createApiRuntime(Deno.env);
  Deno.serve(
    {
      hostname: Deno.env.get("HOST") ?? "127.0.0.1",
      port: resolvePort(Deno.env.get("PORT")),
      onListen: () => undefined,
    },
    configured.app.fetch,
  );
}

import process from "node:process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  createS3CompatibleClient,
  S3CompatibleObjectStorage,
} from "./s3_compatible_object_storage.ts";
import { assert } from "../../../../testing/assert.ts";

type Client = ConstructorParameters<typeof S3CompatibleObjectStorage>[0];

/** Answers the five S3 commands the adapter sends, the way the SDK reports. */
class FakeS3Client {
  bucket = false;
  readonly objects = new Map<
    string,
    { readonly bytes: Uint8Array; readonly type: string | undefined }
  >();
  made = 0;
  failGet = false;

  send(command: unknown): Promise<unknown> {
    if (command instanceof HeadBucketCommand) {
      return this.bucket ? Promise.resolve({}) : Promise.reject(
        Object.assign(new Error("UnknownError"), {
          $metadata: { httpStatusCode: 404 },
          name: "NotFound",
        }),
      );
    }
    if (command instanceof CreateBucketCommand) {
      this.bucket = true;
      this.made += 1;
      return Promise.resolve({});
    }
    if (command instanceof PutObjectCommand) {
      const input = command.input;
      this.objects.set(String(input.Key), {
        bytes: (input.Body as Uint8Array).slice(),
        type: input.ContentType,
      });
      return Promise.resolve({});
    }
    if (command instanceof GetObjectCommand) {
      if (this.failGet) {
        return Promise.reject(new Error("network unavailable"));
      }
      const value = this.objects.get(String(command.input.Key));
      if (!value) {
        return Promise.reject(
          Object.assign(new Error("The specified key does not exist."), {
            $metadata: { httpStatusCode: 404 },
            name: "NoSuchKey",
          }),
        );
      }
      return Promise.resolve({
        Body: { transformToByteArray: () => Promise.resolve(value.bytes) },
      });
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(String(command.input.Key));
      return Promise.resolve({});
    }
    return Promise.reject(new Error("unexpected command"));
  }
}

const ENDPOINT = {
  accessKey: "access",
  host: "127.0.0.1",
  secretKey: "secret-value",
  useSsl: false,
} as const;

async function settled(
  operation: Promise<unknown>,
): Promise<unknown> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(() => "resolved", (error: unknown) => error),
      new Promise<string>((resolve) => {
        guard = setTimeout(() => resolve("still pending"), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(guard);
  }
}

Deno.test("[FILES-001] S3-compatible adapter creates its private bucket once and preserves bytes", async () => {
  const client = new FakeS3Client();
  const storage = new S3CompatibleObjectStorage(
    client as unknown as Client,
    "private-files",
    1_000,
  );
  assert(
    await storage.health() === "not-initialized",
    "missing configured bucket is reported without mutating it",
  );
  await storage.put({
    bytes: new Uint8Array([1, 2, 3]),
    key: "objects/opaque",
    mimeType: "application/pdf",
  });
  await storage.put({ bytes: new Uint8Array([4]), key: "objects/untyped" });
  assert(
    client.objects.get("objects/opaque")?.type === "application/pdf" &&
      client.objects.get("objects/untyped")?.type ===
        "application/octet-stream",
    "a put stores the declared content type, or the opaque default",
  );
  const bytes = await storage.get({ key: "objects/opaque" });
  assert(bytes?.join(",") === "1,2,3", "stored bytes read back");
  assert(client.made === 1, "bucket readiness is authoritative");
  assert(
    await storage.health() === "available",
    "existing configured bucket is healthy",
  );
  await storage.remove({ key: "objects/opaque" });
  assert(
    await storage.get({ key: "objects/opaque" }) === undefined,
    "missing S3 object is explicit",
  );
  client.failGet = true;
  let failure: unknown;
  try {
    await storage.get({ key: "objects/failure" });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, "non-missing object errors propagate");
  client.send = () => Promise.reject(new Error("connection refused"));
  assert(
    await storage.health() === "unavailable",
    "an unreachable store is unavailable",
  );
});

Deno.test("[FILES-001] MCP-E4 a bucket check that fails on first use is tried again by the next operation", async () => {
  const client = new FakeS3Client();
  const send = client.send.bind(client);
  let failures = 1;
  client.send = (command) =>
    command instanceof HeadBucketCommand && failures-- > 0
      ? Promise.reject(new Error("connection reset"))
      : send(command);
  const storage = new S3CompatibleObjectStorage(
    client as unknown as Client,
    "private-files",
    1_000,
  );
  const first = await settled(
    storage.put({ bytes: new Uint8Array([1]), key: "objects/first" }),
  );
  assert(first instanceof Error, "the failed bucket check reaches the caller");
  const second = await settled(
    storage.put({ bytes: new Uint8Array([2]), key: "objects/second" }),
  );
  assert(
    second === "resolved" && client.made === 1 &&
      client.objects.has("objects/second"),
    `one transient failure does not disable the store: ${String(second)}`,
  );
});

Deno.test("[FILES-001] MCP-E4 the S3 client resolves only the configuration it is given", async () => {
  const client = createS3CompatibleClient({ ...ENDPOINT, port: 9000 });
  const config = client.config;
  const credentials = await config.credentials();
  const endpoint = await config.endpoint?.();
  assert(
    credentials.accessKeyId === "access" &&
      credentials.secretAccessKey === "secret-value" &&
      credentials.sessionToken === undefined,
    "credentials are exactly the configured static pair",
  );
  assert(
    endpoint?.protocol === "http:" && endpoint.hostname === "127.0.0.1" &&
      endpoint.port === 9000 && config.isCustomEndpoint === true,
    `the endpoint is exactly the configured store: ${JSON.stringify(endpoint)}`,
  );
  assert(await config.region() === "us-east-1", "the region is explicit");
  assert(config.forcePathStyle === true, "buckets are addressed by path");
  assert(await config.maxAttempts() === 1, "an operation is one request");
  assert(
    !client.middlewareStack.identify().some((entry) =>
      entry.startsWith("recursionDetectionMiddleware")
    ),
    "the Lambda trace middleware is not on the stack",
  );
  client.destroy();
});

/**
 * The names the SDK reads however it is configured, two Lambda probes when it
 * loads and its Node-version warning switch whenever it builds a client. Every
 * process that loads it ignores exactly these (`OBJECT_STORAGE_SDK_IGNORED_ENV`
 * in `tools/tasks/manifest.ts`), so they read as unset and are granted to none.
 */
const SDK_IGNORED_ENV = [
  "AWS_LAMBDA_BENCHMARK_MODE",
  "AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA",
  "AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED",
];

Deno.test("[FILES-001] MCP-E4 the S3 client reads no environment beyond the ignored SDK probes", async () => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", onListen: () => undefined, port: 0 },
    async (request) => {
      await request.arrayBuffer();
      if (request.method === "GET") {
        return new Response(new Uint8Array([7, 8, 9]));
      }
      return new Response(null, {
        status: request.method === "DELETE" ? 204 : 200,
      });
    },
  );
  // Every SDK fallback — the default credential chain, the shared config and
  // credentials files, instance metadata, and each `AWS_*` setting — starts
  // by reading the process environment, so recording every read proves the
  // client consults nothing it was not given.
  const environment = process.env;
  const read: string[] = [];
  process.env = new Proxy(environment, {
    get(target, name, receiver) {
      if (typeof name === "string") read.push(name);
      return Reflect.get(target, name, receiver);
    },
    has(target, name) {
      if (typeof name === "string") read.push(name);
      return Reflect.has(target, name);
    },
    ownKeys(target) {
      read.push("<every name>");
      return Reflect.ownKeys(target);
    },
  });
  const client = createS3CompatibleClient({
    ...ENDPOINT,
    port: server.addr.port,
  });
  try {
    const storage = new S3CompatibleObjectStorage(
      client,
      "quiet-files",
      1_000,
    );
    await storage.put({ bytes: new Uint8Array([7, 8, 9]), key: "objects/a" });
    const bytes = await storage.get({ key: "objects/a" });
    await storage.remove({ key: "objects/a" });
    assert(await storage.health() === "available", "the store answered");
    assert(bytes?.join(",") === "7,8,9", "the bytes read back");
  } finally {
    process.env = environment;
    client.destroy();
    await server.shutdown();
  }
  const consulted = [...new Set(read)].filter((name) =>
    !SDK_IGNORED_ENV.includes(name)
  );
  assert(
    consulted.length === 0,
    `the S3 client read the environment: ${consulted.join(", ")}`,
  );
});

Deno.test("[FILES-001] a store that stalls a request is cut off and its socket destroyed", async () => {
  let aborted = false;
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === "HEAD") {
      response.writeHead(200).end();
      return;
    }
    response.once("close", () => {
      aborted = !response.writableEnded;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = createS3CompatibleClient({
    ...ENDPOINT,
    port: (server.address() as AddressInfo).port,
  });
  try {
    const storage = new S3CompatibleObjectStorage(client, "stalled", 100);
    const outcome = await settled(storage.remove({ key: "objects/opaque" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(
      outcome instanceof Error &&
        outcome.message === "Object storage request timed out after 100ms.",
      `a stalled delete did not settle with the timeout: ${String(outcome)}`,
    );
    assert(aborted, "the timeout destroys the underlying request");
  } finally {
    client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
});

Deno.test("[FILES-001] GAP-037 a store that accepts but never replies settles the read at the configured timeout", async () => {
  // A raw TCP listener that answers the bucket probe on a kept-alive
  // connection and then goes silent: it still accepts and reads every later
  // request but never writes a byte back, the way a paused store behaves.
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const accepted: Deno.Conn[] = [];
  let answered = false;
  const accepting = (async () => {
    for await (const connection of listener) {
      accepted.push(connection);
      (async () => {
        const buffer = new Uint8Array(16_384);
        while (await connection.read(buffer) !== null) {
          if (answered) continue;
          answered = true;
          await connection.write(
            new TextEncoder().encode(
              "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n" +
                "Connection: keep-alive\r\n\r\n",
            ),
          );
        }
      })().catch(() => undefined);
    }
  })();
  const client = createS3CompatibleClient({
    ...ENDPOINT,
    port: listener.addr.port,
  });
  const storage = new S3CompatibleObjectStorage(client, "stalled-files", 100);
  try {
    const started = Date.now();
    const outcome = await settled(storage.get({ key: "objects/stalled" }));
    assert(
      outcome instanceof Error &&
        outcome.message === "Object storage request timed out after 100ms.",
      `a stalled read did not settle with the timeout: ${String(outcome)}`,
    );
    assert(
      Date.now() - started < 2_000,
      "the stalled read outlived its configured timeout",
    );
  } finally {
    client.destroy();
    listener.close();
    for (const connection of accepted) {
      try {
        connection.close();
      } catch {
        // The adapter already tore the socket down.
      }
    }
    await accepting.catch(() => undefined);
  }
});

Deno.test("[FILES-001] MCP-E4 a store that stalls part-way through a body settles the read at the configured timeout", async () => {
  // The headers and the first bytes of the body arrive, then the store goes
  // silent with the rest still owed.
  let aborted = false;
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === "HEAD") {
      response.writeHead(200).end();
      return;
    }
    response.writeHead(200, { "content-length": "10" });
    response.write(new Uint8Array([1, 2, 3]));
    response.once("close", () => {
      aborted = !response.writableEnded;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = createS3CompatibleClient({
    ...ENDPOINT,
    port: (server.address() as AddressInfo).port,
  });
  try {
    const storage = new S3CompatibleObjectStorage(client, "partial", 150);
    const started = Date.now();
    const outcome = await settled(storage.get({ key: "objects/partial" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(
      outcome instanceof Error &&
        outcome.message === "Object storage request timed out after 150ms.",
      `a stalled body did not settle with the timeout: ${String(outcome)}`,
    );
    assert(
      Date.now() - started < 2_000,
      "the stalled body outlived its configured timeout",
    );
    assert(aborted, "the timeout destroys the stalled response");
  } finally {
    client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
});

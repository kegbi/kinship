import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createObjectStorageRequestTransport,
  S3CompatibleObjectStorage,
} from "./s3_compatible_object_storage.ts";
import { assert } from "../../../../testing/assert.ts";

class FakeS3Client {
  bucket = false;
  readonly objects = new Map<string, Uint8Array>();
  made = 0;

  bucketExists(): Promise<boolean> {
    return Promise.resolve(this.bucket);
  }
  makeBucket(): Promise<void> {
    this.bucket = true;
    this.made += 1;
    return Promise.resolve();
  }
  getObject(_bucket: string, key: string): Promise<AsyncIterable<Uint8Array>> {
    const value = this.objects.get(key);
    if (!value) {
      return Promise.reject(
        Object.assign(new Error("missing"), { code: "NoSuchKey" }),
      );
    }
    return Promise.resolve((async function* () {
      yield value.slice(0, 1);
      yield value.slice(1);
    })());
  }
  putObject(_bucket: string, key: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(key, bytes.slice());
    return Promise.resolve();
  }
  removeObject(_bucket: string, key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

Deno.test("[FILES-001] object-store request transport destroys stalled sockets", async () => {
  let aborted = false;
  const server = createServer((_request, response) => {
    response.once("close", () => {
      aborted = !response.writableEnded;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const transport = createObjectStorageRequestTransport(false, 25);
    const failure = await new Promise<unknown>((resolve) => {
      const request = transport.request({
        hostname: "127.0.0.1",
        method: "DELETE",
        path: "/private-files/opaque",
        port: (server.address() as AddressInfo).port,
      });
      request.once("error", resolve);
      request.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert(
      failure instanceof Error && failure.message.includes("timed out") &&
        aborted,
      "timeout destroys the underlying Node request",
    );
    assert(
      typeof createObjectStorageRequestTransport(true, 25).request ===
        "function",
      "SSL configuration selects an HTTPS request transport",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
});

Deno.test("[FILES-001] S3-compatible adapter creates its private bucket once and preserves bytes", async () => {
  const client = new FakeS3Client();
  const storage = new S3CompatibleObjectStorage(client, "private-files");
  assert(
    await storage.health() === "not-initialized",
    "missing configured bucket is reported without mutating it",
  );
  await storage.put({
    bytes: new Uint8Array([1, 2, 3]),
    key: "objects/opaque",
    mimeType: "application/pdf",
  });
  const bytes = await storage.get({ key: "objects/opaque" });
  assert(bytes?.join(",") === "1,2,3", "stream chunks reassemble");
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
  client.getObject = () => Promise.reject(new Error("network unavailable"));
  let failure: unknown;
  try {
    await storage.get({ key: "objects/failure" });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, "non-missing object errors propagate");
});

import type { ObjectStorage } from "../../application/person_files.ts";
import { Buffer } from "node:buffer";
import * as http from "node:http";
import * as https from "node:https";

export type ObjectStorageRequestTransport = Pick<typeof http, "request">;

export function createObjectStorageRequestTransport(
  useSsl: boolean,
  timeoutMs: number,
): ObjectStorageRequestTransport {
  const transport: ObjectStorageRequestTransport = useSsl ? https : http;
  return {
    request: ((...args: unknown[]) => {
      const request = (
        transport.request as unknown as (
          ...requestArguments: unknown[]
        ) => http.ClientRequest
      )(...args);
      const timeout = setTimeout(() => {
        request.destroy(
          new Error(`Object storage request timed out after ${timeoutMs}ms.`),
        );
      }, timeoutMs);
      const clearRequestTimeout = () => clearTimeout(timeout);
      request.once("error", clearRequestTimeout);
      request.once("response", (response) => {
        response.once("close", clearRequestTimeout);
        response.once("end", clearRequestTimeout);
        response.once("error", clearRequestTimeout);
      });
      return request;
    }) as typeof http.request,
  };
}

interface S3CompatibleClient {
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string): Promise<unknown>;
  getObject(
    bucket: string,
    key: string,
  ): Promise<AsyncIterable<Uint8Array | string>>;
  putObject(
    bucket: string,
    key: string,
    bytes: Uint8Array,
    size: number,
    metadata: Readonly<Record<string, string>>,
  ): Promise<unknown>;
  removeObject(bucket: string, key: string): Promise<unknown>;
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "NoSuchKey" || code === "NotFound";
}

export class S3CompatibleObjectStorage implements ObjectStorage {
  #ready?: Promise<void>;
  readonly provider = "s3";

  constructor(
    private readonly client: S3CompatibleClient,
    readonly bucket: string,
  ) {}

  #ensureBucket(): Promise<void> {
    this.#ready ??= (async () => {
      if (!(await this.client.bucketExists(this.bucket))) {
        await this.client.makeBucket(this.bucket);
      }
    })();
    return this.#ready;
  }

  async get(
    command: { readonly key: string },
  ): Promise<Uint8Array | undefined> {
    await this.#ensureBucket();
    try {
      const stream = await this.client.getObject(this.bucket, command.key);
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const value of stream) {
        const chunk = typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array(value);
        chunks.push(chunk);
        length += chunk.byteLength;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async put(command: {
    readonly bytes: Uint8Array;
    readonly key: string;
    readonly mimeType?: string;
  }): Promise<void> {
    await this.#ensureBucket();
    await this.client.putObject(
      this.bucket,
      command.key,
      Buffer.from(command.bytes),
      command.bytes.byteLength,
      { "Content-Type": command.mimeType ?? "application/octet-stream" },
    );
  }

  async remove(command: { readonly key: string }): Promise<void> {
    await this.#ensureBucket();
    await this.client.removeObject(this.bucket, command.key);
  }
}

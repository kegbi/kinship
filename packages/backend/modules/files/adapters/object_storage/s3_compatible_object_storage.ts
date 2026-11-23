import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectStorage } from "../../ports/object_storage.ts";

/** Where the deployment's S3-compatible store is, and how to sign for it. */
export interface S3CompatibleEndpoint {
  readonly accessKey: string;
  readonly host: string;
  readonly port: number;
  readonly secretKey: string;
  readonly useSsl: boolean;
}

/**
 * The S3 client for this deployment's own store, configured only from the
 * endpoint it is given.
 *
 * The SDK resolves every setting left out of its constructor from `AWS_*`
 * environment variables and the shared `~/.aws` config and credentials files,
 * and falls back to its default credential chain, which ends in instance
 * metadata. Each setting it would otherwise look up is therefore stated here,
 * most at the SDK's own default, so nothing outside this application's
 * configuration is consulted. The adapter test proves the client reads no
 * environment while it works beyond three probes it makes however it is
 * configured, which every process that loads it ignores (`--ignore-env`).
 */
export function createS3CompatibleClient(
  endpoint: S3CompatibleEndpoint,
): S3Client {
  const client = new S3Client({
    // Static credentials: the default chain is never built.
    credentials: {
      accessKeyId: endpoint.accessKey,
      secretAccessKey: endpoint.secretKey,
    },
    endpoint: `${
      endpoint.useSsl ? "https" : "http"
    }://${endpoint.host}:${endpoint.port}`,
    // The store is a private host such as `object-store`; virtual-hosted
    // addressing would resolve `<bucket>.object-store`, which does not exist.
    forcePathStyle: true,
    // SigV4 needs a region. The pinned RustFS accepts a signature for any
    // region, so this is S3's own default.
    region: "us-east-1",
    // One request per operation, as before the SDK: the configured timeout
    // bounds one exchange, and a failure reaches the caller unretried.
    maxAttempts: 1,
    retryMode: "standard",
    // The SDK's default, flexible checksums: the pinned RustFS accepts the
    // CRC32 a put sends and returns it for the read to verify.
    requestChecksumCalculation: "WHEN_SUPPORTED",
    responseChecksumValidation: "WHEN_SUPPORTED",
    // The remaining settings the SDK would read from `AWS_*` or `~/.aws`,
    // each at its default for a plain S3 endpoint.
    authSchemePreference: [],
    defaultsMode: "legacy",
    disableClockSkewCorrection: false,
    disableS3ExpressSessionAuth: true,
    useArnRegion: false,
    useDualstackEndpoint: false,
    useFipsEndpoint: false,
    userAgentAppId: "",
    // The default user agent reads `AWS_EXECUTION_ENV` and the OS release, a
    // `sys` permission no process holds.
    defaultUserAgentProvider: () => Promise.resolve([["kinship"]]),
  });
  // Lambda trace propagation reads Lambda's environment
  // (`AWS_LAMBDA_FUNCTION_NAME`, `_X_AMZN_TRACE_ID`) on every request;
  // nothing here runs in Lambda.
  client.middlewareStack.remove("recursionDetectionMiddleware");
  return client;
}

type S3Sender = Pick<S3Client, "send">;

/** A missing object (`NoSuchKey`) or bucket (`NotFound`, a bodiless 404). */
function isMissing(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "NoSuchKey" || error.name === "NotFound");
}

export class S3CompatibleObjectStorage implements ObjectStorage {
  #ready?: Promise<void>;
  readonly provider = "s3";

  constructor(
    private readonly client: S3Sender,
    readonly bucket: string,
    private readonly requestTimeoutMs: number,
  ) {}

  /**
   * One exchange with the store, cut off at the configured timeout. The
   * timeout runs until the operation has its whole answer, so a store that
   * stalls before its headers or part-way through a body is cut off alike:
   * the request is aborted, a body already streaming is destroyed, and the
   * caller is settled here whether or not the SDK reports the abort.
   */
  async #exchange<T>(
    operation: (
      abortSignal: AbortSignal,
      streaming: (body: unknown) => void,
    ) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let body: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(
          `Object storage request timed out after ${this.requestTimeoutMs}ms.`,
        );
        controller.abort(error);
        if (body && typeof body === "object" && "destroy" in body) {
          (body as { destroy(error?: Error): void }).destroy(error);
        }
        reject(error);
      }, this.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        operation(controller.signal, (received) => {
          body = received;
        }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #bucketExists(): Promise<boolean> {
    try {
      await this.#exchange((abortSignal) =>
        this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
          abortSignal,
        })
      );
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  #ensureBucket(): Promise<void> {
    this.#ready ??= (async () => {
      if (!(await this.#bucketExists())) {
        await this.#exchange((abortSignal) =>
          this.client.send(new CreateBucketCommand({ Bucket: this.bucket }), {
            abortSignal,
          })
        );
      }
    })();
    return this.#ready;
  }

  async get(
    command: { readonly key: string },
  ): Promise<Uint8Array | undefined> {
    await this.#ensureBucket();
    try {
      return await this.#exchange(async (abortSignal, streaming) => {
        const output = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: command.key }),
          { abortSignal },
        );
        if (!output.Body) return new Uint8Array();
        streaming(output.Body);
        return await output.Body.transformToByteArray();
      });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async health(): Promise<"available" | "not-initialized" | "unavailable"> {
    try {
      return await this.#bucketExists() ? "available" : "not-initialized";
    } catch {
      return "unavailable";
    }
  }

  async put(command: {
    readonly bytes: Uint8Array;
    readonly key: string;
    readonly mimeType?: string;
  }): Promise<void> {
    await this.#ensureBucket();
    await this.#exchange((abortSignal) =>
      this.client.send(
        new PutObjectCommand({
          Body: command.bytes,
          Bucket: this.bucket,
          ContentLength: command.bytes.byteLength,
          ContentType: command.mimeType ?? "application/octet-stream",
          Key: command.key,
        }),
        { abortSignal },
      )
    );
  }

  async remove(command: { readonly key: string }): Promise<void> {
    await this.#ensureBucket();
    await this.#exchange((abortSignal) =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: command.key }),
        { abortSignal },
      )
    );
  }
}

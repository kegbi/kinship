import type { PasswordHasher, RandomSource } from "../../ports/security.ts";

export interface Argon2idParameters {
  readonly hashLength: number;
  readonly iterations: number;
  readonly memoryKiB: number;
  readonly parallelism: number;
  readonly saltLength: number;
}

interface ParsedHash {
  readonly hash: Uint8Array;
  readonly iterations: number;
  readonly memoryKiB: number;
  readonly parallelism: number;
  readonly salt: Uint8Array;
}

const FORMAT_PREFIX = "$kinship$argon2id$v=1$";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  try {
    return Uint8Array.from(
      atob(padded),
      (character) => character.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parse(encoded: string): ParsedHash | undefined {
  if (!encoded.startsWith(FORMAT_PREFIX)) return undefined;
  const [parameters, saltValue, hashValue, extra] = encoded.slice(
    FORMAT_PREFIX.length,
  ).split("$");
  if (extra !== undefined) return undefined;
  const entries = Object.fromEntries(
    (parameters ?? "").split(",").map((entry) => entry.split("=", 2)),
  );
  const memoryKiB = parsePositiveInteger(entries.m);
  const iterations = parsePositiveInteger(entries.t);
  const parallelism = parsePositiveInteger(entries.p);
  const salt = saltValue === undefined ? undefined : decodeBase64Url(saltValue);
  const hash = hashValue === undefined ? undefined : decodeBase64Url(hashValue);
  if (
    !memoryKiB || !iterations || !parallelism || !salt?.length || !hash?.length
  ) return undefined;
  return { hash, iterations, memoryKiB, parallelism, salt };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function derive(
  password: string,
  parameters: ParsedHash,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "Argon2id",
    false,
    ["deriveBits"],
  );
  // Deno exposes Argon2id before TypeScript's Web Crypto declarations include
  // its parameter shape, so keep this compatibility assertion at the adapter.
  const algorithm = {
    name: "Argon2id",
    nonce: parameters.salt,
    parallelism: parameters.parallelism,
    memory: parameters.memoryKiB,
    passes: parameters.iterations,
  } as AlgorithmIdentifier;
  const bits = await crypto.subtle.deriveBits(
    algorithm,
    key,
    parameters.hash.length * 8,
  );
  return new Uint8Array(bits);
}

export class Argon2idPasswordHasher implements PasswordHasher {
  constructor(
    private readonly random: RandomSource,
    private readonly parameters: Argon2idParameters,
  ) {}

  async hash(password: string): Promise<string> {
    const salt = this.random.bytes(this.parameters.saltLength);
    const parsed: ParsedHash = {
      salt,
      hash: new Uint8Array(this.parameters.hashLength),
      memoryKiB: this.parameters.memoryKiB,
      iterations: this.parameters.iterations,
      parallelism: this.parameters.parallelism,
    };
    const hash = await derive(password, parsed);
    return `${FORMAT_PREFIX}m=${parsed.memoryKiB},t=${parsed.iterations},p=${parsed.parallelism}$${
      encodeBase64Url(salt)
    }$${encodeBase64Url(hash)}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (!parsed) return false;
    try {
      return constantTimeEqual(await derive(password, parsed), parsed.hash);
    } catch {
      return false;
    }
  }

  needsUpgrade(encoded: string): boolean {
    const parsed = parse(encoded);
    return parsed === undefined ||
      parsed.memoryKiB < this.parameters.memoryKiB ||
      parsed.iterations < this.parameters.iterations ||
      parsed.parallelism < this.parameters.parallelism ||
      parsed.hash.length < this.parameters.hashLength;
  }
}

import type { RandomSource } from "../../ports/security.ts";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
        Math.ceil(value.length / 4) * 4,
        "=",
      ),
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function decodeBase32(value: string): Uint8Array | undefined {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.replaceAll(" ", "").replaceAll("-", "").toUpperCase();
  if (!clean || [...clean].some((character) => !alphabet.includes(character))) {
    return undefined;
  }
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export interface MfaEncryptionKeyset {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Uint8Array>;
}

function validKeyId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

function validatedKeyset(keyset: MfaEncryptionKeyset): MfaEncryptionKeyset {
  const entries = [...keyset.keys.entries()];
  if (
    !validKeyId(keyset.activeKeyId) || entries.length < 1 ||
    entries.length > 8
  ) {
    throw new Error("AUTH_MFA_ENCRYPTION_KEYSET is invalid.");
  }
  const keys = new Map<string, Uint8Array>();
  for (const [keyId, key] of entries) {
    if (!validKeyId(keyId) || key.length !== 32) {
      throw new Error("AUTH_MFA_ENCRYPTION_KEYSET is invalid.");
    }
    keys.set(keyId, new Uint8Array(key));
  }
  if (!keys.has(keyset.activeKeyId)) {
    throw new Error("AUTH_MFA_ENCRYPTION_KEYSET active key is missing.");
  }
  return { activeKeyId: keyset.activeKeyId, keys };
}

export function decodeMfaEncryptionKeyset(value: string): MfaEncryptionKeyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AUTH_MFA_ENCRYPTION_KEYSET must be valid JSON.");
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    !("activeKeyId" in parsed) || !("keys" in parsed) ||
    typeof parsed.activeKeyId !== "string" ||
    typeof parsed.keys !== "object" || parsed.keys === null ||
    Array.isArray(parsed.keys)
  ) {
    throw new Error("AUTH_MFA_ENCRYPTION_KEYSET is invalid.");
  }
  const entries = Object.entries(parsed.keys).map(([keyId, encoded]) => {
    const key = typeof encoded === "string"
      ? decodeBase64Url(encoded)
      : undefined;
    if (key?.length !== 32) {
      throw new Error(
        "AUTH_MFA_ENCRYPTION_KEYSET keys must be 32 base64url bytes.",
      );
    }
    return [keyId, key] as const;
  });
  return validatedKeyset({
    activeKeyId: parsed.activeKeyId,
    keys: new Map(entries),
  });
}

export class AesGcmMfaSecretBox {
  readonly #keyset: MfaEncryptionKeyset;

  constructor(
    keyset: MfaEncryptionKeyset,
    private readonly random: RandomSource,
  ) {
    this.#keyset = validatedKeyset(keyset);
  }

  async encrypt(secret: string, userId: string): Promise<string> {
    const iv = this.random.bytes(12);
    const keyId = this.#keyset.activeKeyId;
    const keyBytes = this.#keyset.keys.get(keyId)!;
    const additionalData = this.#additionalData(keyId, userId);
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(keyBytes).buffer,
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const cipher = await crypto.subtle.encrypt(
      {
        additionalData,
        iv: new Uint8Array(iv).buffer,
        name: "AES-GCM",
      },
      key,
      new TextEncoder().encode(secret),
    );
    return `v1.${keyId}.${base64Url(iv)}.${base64Url(new Uint8Array(cipher))}`;
  }

  async decrypt(
    encrypted: string,
    userId: string,
  ): Promise<string | undefined> {
    const [version, keyId, ivValue, cipherValue, extra] = encrypted.split(".");
    const iv = ivValue ? decodeBase64Url(ivValue) : undefined;
    const cipher = cipherValue ? decodeBase64Url(cipherValue) : undefined;
    const keyBytes = keyId ? this.#keyset.keys.get(keyId) : undefined;
    if (
      version !== "v1" || extra !== undefined || iv?.length !== 12 ||
      !cipher || !keyBytes || !keyId
    ) {
      return undefined;
    }
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(keyBytes).buffer,
        "AES-GCM",
        false,
        ["decrypt"],
      );
      const plain = await crypto.subtle.decrypt(
        {
          additionalData: this.#additionalData(keyId, userId),
          iv: new Uint8Array(iv).buffer,
          name: "AES-GCM",
        },
        key,
        new Uint8Array(cipher).buffer,
      );
      return new TextDecoder().decode(plain);
    } catch {
      return undefined;
    }
  }

  #additionalData(keyId: string, userId: string): ArrayBuffer {
    return new TextEncoder().encode(
      `kinship.user-mfa-totp.v1.${keyId}.${userId}`,
    ).buffer;
  }
}

async function totpAt(
  secret: string,
  counter: number,
): Promise<string | undefined> {
  const keyBytes = decodeBase32(secret);
  if (!keyBytes?.length || !Number.isSafeInteger(counter) || counter < 0) {
    return undefined;
  }
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes).buffer,
    { hash: "SHA-1", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, message),
  );
  const offset = (signature.at(-1) ?? 0) & 0x0f;
  const binary = ((signature[offset] ?? 0) & 0x7f) << 24 |
    (signature[offset + 1] ?? 0) << 16 |
    (signature[offset + 2] ?? 0) << 8 |
    (signature[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function generateTotp(
  secret: string,
  now: Date,
): Promise<string | undefined> {
  return totpAt(secret, Math.floor(now.getTime() / 30_000));
}

export async function verifyTotp(
  secret: string,
  code: string,
  now: Date,
  lastUsedAt?: Date,
): Promise<{ readonly counter: number; readonly valid: boolean }> {
  if (!/^\d{6}$/.test(code)) return { counter: 0, valid: false };
  const current = Math.floor(now.getTime() / 30_000);
  for (const counter of [current - 1, current, current + 1]) {
    if (await totpAt(secret, counter) !== code) continue;
    const lastCounter = lastUsedAt
      ? Math.floor(lastUsedAt.getTime() / 30_000)
      : -1;
    return { counter, valid: counter > lastCounter };
  }
  return { counter: current, valid: false };
}

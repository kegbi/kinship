export interface AuthenticationSubjectKeyset {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Uint8Array>;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Authentication subject keys must use base64url.");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Authentication subject keys must use base64url.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeAuthenticationSubjectKeyset(
  encoded: string,
  name = "AUTH_THROTTLE_SUBJECT_KEYSET",
): AuthenticationSubjectKeyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${name} must be an object.`);
  }
  const value = parsed as { activeVersion?: unknown; keys?: unknown };
  if (
    !Number.isSafeInteger(value.activeVersion) ||
    (value.activeVersion as number) < 1 ||
    typeof value.keys !== "object" || value.keys === null ||
    Array.isArray(value.keys)
  ) {
    throw new Error(`${name} has an invalid shape.`);
  }
  const entries = Object.entries(value.keys);
  if (entries.length === 0 || entries.length > 8) {
    throw new Error(`${name} must contain 1 to 8 keys.`);
  }
  const keys = new Map<number, Uint8Array>();
  for (const [label, encodedKey] of entries) {
    const match = /^v([1-9][0-9]*)$/.exec(label);
    if (!match || typeof encodedKey !== "string") {
      throw new Error(
        "Authentication subject key versions must be v1 or newer.",
      );
    }
    const version = Number(match[1]);
    if (
      !Number.isSafeInteger(version) || version < 1 ||
      `v${version}` !== label || keys.has(version)
    ) {
      throw new Error(
        "Authentication subject key versions must be canonical safe integers.",
      );
    }
    const key = decodeBase64Url(encodedKey);
    if (key.length !== 32) {
      throw new Error("Authentication subject keys must decode to 32 bytes.");
    }
    keys.set(version, key);
  }
  const activeVersion = value.activeVersion as number;
  if (!keys.has(activeVersion)) {
    throw new Error("The active authentication subject key is missing.");
  }
  return { activeVersion, keys };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export class AuthenticationSubjectDigester {
  constructor(private readonly keyset: AuthenticationSubjectKeyset) {}

  async digestCandidates(
    scope: "mfa" | "password",
    rawSubject: string,
  ): Promise<readonly string[]> {
    const subject = scope === "password"
      ? rawSubject.trim().toLowerCase()
      : rawSubject;
    const versions = [
      this.keyset.activeVersion,
      ...[...this.keyset.keys.keys()].filter((version) =>
        version !== this.keyset.activeVersion
      ).sort((left, right) => right - left),
    ];
    return await Promise.all(versions.map(async (version) => {
      const bytes = this.keyset.keys.get(version);
      if (!bytes) throw new Error("Authentication subject key disappeared.");
      const key = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(bytes).buffer,
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["sign"],
      );
      const digest = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(
          `kinship.authentication.${scope}.v1\n${subject}`,
        ),
      );
      return `hmac-sha256:v${version}:${hex(new Uint8Array(digest))}`;
    }));
  }
}

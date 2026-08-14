import type { RandomSource } from "../../ports/security.ts";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

export class WebCryptoRandomSource implements RandomSource {
  bytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }
}

export class SecureTokenService {
  constructor(private readonly random: RandomSource) {}

  async create(): Promise<{ readonly hash: string; readonly raw: string }> {
    const raw = base64Url(this.random.bytes(32));
    return { raw, hash: await this.hash(raw) };
  }

  async hash(raw: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw),
    );
    return base64Url(new Uint8Array(digest));
  }
}
